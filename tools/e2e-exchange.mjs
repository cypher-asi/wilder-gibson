// Headless end-to-end verification of the order-book exchange (dev only).
// Usage: node tools/e2e-exchange.mjs
// Requires a gateway running with WILDER_DEV=1 (dev slash commands: /give, /tp).
// Recommended: a fresh data dir so books/venues initialize cleanly, e.g.
//   $env:WILDER_DATA="tmp/e2e-world"; $env:WILDER_DEV="1"; $env:WILDER_PORT="8091";
//   $env:WILDER_AGENTS="800"; cargo run -p wilder-gateway
//   E2E_PORT=8091 node tools/e2e-exchange.mjs
// Node >= 22 (global fetch + WebSocket).
//
// What it verifies over the real ws protocol:
//   1. MarketsSub -> MarketsState (venues list + ticker rows) + MyExchangeState.
//   2. BookSub (venue, asset) -> full BookState snapshot.
//   3. Terminal presence gating: placing away from the venue's terminal is
//      rejected; placing at the WRONG venue's terminal is rejected.
//   4. Order flow at venue 1: A rests a limit ask (iron escrowed from the real
//      backpack), B crosses with a limit bid (MILD escrowed, price improvement
//      refunded), fill executes at the maker price, tape/last update, maker
//      gets an OrderUpdate toast.
//   5. Settlement: A's inbox gets seller proceeds minus the 5% taker fee, B's
//      inbox gets the units; Claim at the venue moves MILD to the wallet
//      (WalletUpdate) and items to the backpack (InventoryUpdate).
//   6. Cancel refunds resting escrow.
//   7. Venue independence: hauling iron to a second venue and trading at a
//      different price leaves each venue's last price independent; the markets
//      index rolls both venues up on the IRON row with 24h volume.
//   8. Agent activity: books/rows show life beyond this script's own trades
//      (skipped with a note if agents haven't warmed up yet).

const PORT = process.env.E2E_PORT ?? "8080";
const BASE = `http://localhost:${PORT}`;

function log(...args) {
  console.log(new Date().toISOString().slice(11, 23), ...args);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IRON = { t: "Item", d: "Iron" };
const assetEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

class Client {
  constructor(tag) {
    this.tag = tag;
    this.inventory = null;
    this.wallet = null;
    this.entityId = 0;
    this.pos = [0, 0, 0];
    this.markets = null; // latest MarketsState
    this.book = null; // latest BookState
    this.my = { orders: [], inboxes: [] }; // latest MyExchangeState
    this.orderUpdates = [];
    this.waiters = [];
  }

  async login(username, name) {
    const creds = { username, password: "e2e-password-1" };
    let res = await fetch(`${BASE}/api/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(creds),
    });
    if (!res.ok) {
      res = await fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(creds),
      });
    }
    if (!res.ok) throw new Error(`login ${username} failed: ${res.status}`);
    this.token = (await res.json()).token;
    const headers = { authorization: `Bearer ${this.token}` };
    const chars = await (await fetch(`${BASE}/api/characters`, { headers })).json();
    let me = chars.find((c) => c.name === name);
    if (!me) {
      const created = await fetch(`${BASE}/api/characters`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!created.ok) throw new Error("character create failed");
      me = await created.json();
    }
    this.characterId = me.id;
    log(`[${this.tag}] logged in as ${name} (${this.characterId})`);
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      ws.onopen = () => this.send({ t: "Authenticate", d: { token: this.token } });
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") return; // Snapshot / map intel — not needed
        const msg = JSON.parse(ev.data);
        this.handle(msg);
        if (msg.t === "WorldJoined") resolve();
      };
      ws.onerror = () => reject(new Error("ws error"));
      setTimeout(() => reject(new Error("join timeout")), 30000);
    });
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  handle(msg) {
    switch (msg.t) {
      case "AuthResult":
        if (!msg.d.ok) throw new Error("auth failed: " + msg.d.error);
        this.send({ t: "JoinWorld", d: { character_id: this.characterId } });
        break;
      case "WorldJoined":
        this.entityId = msg.d.entity_id;
        this.pos = msg.d.character.position;
        this.inventory = msg.d.inventory;
        log(`[${this.tag}] joined as entity ${this.entityId} at`, this.pos.map((v) => v.toFixed(1)).join(","));
        break;
      case "InventoryUpdate":
        this.inventory = msg.d;
        break;
      case "WalletUpdate":
        this.wallet = msg.d;
        break;
      case "MarketsState":
        this.markets = msg.d;
        break;
      case "BookState":
        this.book = msg.d;
        break;
      case "MyExchangeState":
        this.my = msg.d;
        break;
      case "OrderUpdate":
        this.orderUpdates.push(msg.d);
        log(`[${this.tag}] << OrderUpdate`, JSON.stringify(msg.d));
        break;
      case "Ping":
        this.send({ t: "Pong", d: { nonce: msg.d.nonce } });
        break;
      case "Error":
        log(`[${this.tag}] << Error`, msg.d.message);
        break;
    }
    for (const w of [...this.waiters]) {
      if (w.pred(msg)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  }

  waitFor(pred, timeoutMs = 10000, label = "message") {
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          reject(new Error(`[${this.tag}] timeout waiting for ${label}`));
        }
      }, timeoutMs);
    });
  }

  chat(text) {
    this.send({ t: "Chat", d: { text } });
  }

  tp(x, z) {
    this.chat(`/tp ${x} ${z}`);
  }

  invCount(kind) {
    return (this.inventory?.slots ?? [])
      .filter((s) => s && s.kind === kind)
      .reduce((n, s) => n + s.count, 0);
  }

  /** Send an ExchangeAction and wait for its OrderResult. */
  async exchange(action, label) {
    const p = this.waitFor((m) => m.t === "OrderResult", 10000, `OrderResult (${label})`);
    this.send({ t: "Exchange", d: action });
    return (await p).d;
  }

  place(venue, asset, side, price, qty, maxSpend = null) {
    return this.exchange(
      {
        t: "Place",
        d: {
          venue,
          asset,
          side,
          order: price == null ? { t: "Market" } : { t: "Limit", d: { price } },
          qty,
          max_spend: maxSpend,
        },
      },
      `place ${side} ${qty}@${price ?? "mkt"} v${venue}`,
    );
  }

  inboxAt(venue) {
    return (this.my.inboxes ?? []).find((i) => i.venue === venue)?.inbox ?? null;
  }
}

async function waitForGateway() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // gateway still booting
    }
    await sleep(1000);
  }
  throw new Error(`gateway on :${PORT} never became healthy`);
}

async function main() {
  await waitForGateway();
  log(`gateway healthy on :${PORT}`);

  const a = new Client("A");
  const b = new Client("B");
  await a.login("e2ex_alice", "ExAlice");
  await b.login("e2ex_bob", "ExBob");
  await a.connect();
  await b.connect();
  await sleep(600);

  // ---- 1. Markets index subscription -----------------------------------
  const marketsP = a.waitFor((m) => m.t === "MarketsState", 10000, "MarketsState");
  const myStateP = a.waitFor((m) => m.t === "MyExchangeState", 10000, "MyExchangeState");
  a.send({ t: "MarketsSub", d: { on: true } });
  const markets = (await marketsP).d;
  await myStateP;
  if (!markets.venues?.length) throw new Error("MarketsState has no venues");
  if (!markets.rows?.length) throw new Error("MarketsState has no asset rows");
  const ironRow0 = markets.rows.find((r) => r.ticker === "IRON");
  if (!ironRow0) throw new Error("no IRON row in the markets index");
  log(
    `PASS markets sub: ${markets.venues.length} venues, ${markets.rows.length} asset rows`,
    `(venues: ${markets.venues.slice(0, 4).map((v) => v.name).join(", ")}...)`,
  );

  if (markets.venues.length < 2) throw new Error("need >= 2 venues for the arbitrage leg");
  const v1 = markets.venues[0];
  const v2 = markets.venues[1];

  // ---- 2. Book subscription --------------------------------------------
  const bookP = a.waitFor(
    (m) => m.t === "BookState" && m.d.venue === v1.venue && assetEq(m.d.asset, IRON),
    10000,
    "BookState",
  );
  a.send({ t: "BookSub", d: { market: { venue: v1.venue, asset: IRON } } });
  const book0 = (await bookP).d;
  if (!Array.isArray(book0.bids) || !Array.isArray(book0.asks)) {
    throw new Error("BookState missing depth arrays");
  }
  b.send({ t: "BookSub", d: { market: { venue: v1.venue, asset: IRON } } });
  await b.waitFor((m) => m.t === "BookState", 10000, "BookState (B)");
  log(`PASS book sub: BookState for ${v1.name} IRON (bids ${book0.bids.length}, asks ${book0.asks.length})`);

  // ---- 3. Presence gating -----------------------------------------------
  // Far from any terminal: place must be rejected.
  a.tp(v1.x + 40, v1.z + 40);
  await sleep(500);
  const rejected = await a.place(v1.venue, IRON, "Ask", 10, 1);
  if (rejected.ok || !/terminal/i.test(rejected.error ?? "")) {
    throw new Error("expected 'not at terminal' rejection, got " + JSON.stringify(rejected));
  }
  log("PASS presence gating (away):", rejected.error);

  // Fund the actors and station them at venue 1's terminal.
  a.chat("/give iron 10");
  b.chat("/give wild 1000");
  await sleep(500);
  if (a.invCount("Iron") < 10) throw new Error("A did not receive iron");
  a.tp(v1.x + 1, v1.z);
  b.tp(v1.x + 1, v1.z + 1);
  await sleep(500);

  // At venue 1's terminal but targeting venue 2: still rejected.
  const wrongVenue = await a.place(v2.venue, IRON, "Ask", 10, 1);
  if (wrongVenue.ok || !/terminal/i.test(wrongVenue.error ?? "")) {
    throw new Error("expected wrong-venue rejection, got " + JSON.stringify(wrongVenue));
  }
  log("PASS presence gating (wrong venue):", wrongVenue.error);

  // ---- 4. Order flow: resting ask, crossing bid --------------------------
  const ironBeforeAsk = a.invCount("Iron");
  const res1 = await a.place(v1.venue, IRON, "Ask", 10, 5);
  if (!res1.ok) throw new Error("ask place failed: " + res1.error);
  await sleep(300);
  if (a.invCount("Iron") !== ironBeforeAsk - 5) throw new Error("iron not escrowed on ask");
  if (!a.my.orders.some((o) => o.venue === v1.venue && o.side === "Ask" && o.qty === 5)) {
    throw new Error("resting ask missing from MyExchangeState: " + JSON.stringify(a.my.orders));
  }
  if (!a.book.asks.some(([p, q]) => p === 10 && q >= 5)) {
    throw new Error("resting ask missing from BookState depth: " + JSON.stringify(a.book.asks));
  }
  log("PASS resting ask: 5 IRON @ 10 escrowed from the backpack, on the book");

  // B crosses with a limit bid at 12: executes at the maker's 10, and the
  // 2/unit price improvement refunds immediately. Maker A gets an
  // OrderUpdate toast for the fill.
  const bWildBefore = b.wallet?.wild ?? 0;
  const fillToastP = a.waitFor(
    (m) => m.t === "OrderUpdate" && m.d.kind === "Filled",
    10000,
    "maker fill OrderUpdate",
  );
  const res2 = await b.place(v1.venue, IRON, "Bid", 12, 5);
  if (!res2.ok) throw new Error("crossing bid failed: " + res2.error);
  const toast = (await fillToastP).d;
  if (toast.fill_price !== 10 || toast.fill_qty !== 5) {
    throw new Error("bad maker fill toast: " + JSON.stringify(toast));
  }
  await sleep(400);
  if (b.book.last !== 10) throw new Error(`book last should be 10, got ${b.book.last}`);
  if (!b.book.tape.some((t) => t.price === 10 && t.qty === 5 && t.side === "Bid")) {
    throw new Error("fill missing from tape: " + JSON.stringify(b.book.tape));
  }
  if (b.book.asks.some(([p]) => p === 10)) throw new Error("ask level should be consumed");
  // Escrow was 60 (5 x 12); execution at 10 costs 50, 10 refunds.
  const bWildAfter = b.wallet?.wild ?? 0;
  if (bWildBefore - bWildAfter !== 50) {
    throw new Error(`bid should net 50 MILD (60 locked - 10 improvement), spent ${bWildBefore - bWildAfter}`);
  }
  log("PASS crossing bid: filled 5 @ 10 (maker price), 10 MILD price improvement refunded, tape/last updated");

  // ---- 5. Settlement inboxes + claims ------------------------------------
  // Seller proceeds: gross 50 - floor(50 * 5%) = 48 MILD. Buyer: 5 iron units.
  const aInbox = a.inboxAt(v1.venue);
  if (Number(aInbox?.mild) !== 48) {
    throw new Error("A inbox should hold 48 MILD proceeds: " + JSON.stringify(aInbox));
  }
  const bInbox = b.inboxAt(v1.venue);
  const bIronCredit = (bInbox?.assets ?? []).find((q) => assetEq(q.asset, IRON));
  if (bIronCredit?.qty !== 5) {
    throw new Error("B inbox should hold 5 IRON: " + JSON.stringify(bInbox));
  }
  log("PASS settlement inboxes: A +48 MILD (5% fee carved), B +5 IRON");

  const aWalletP = a.waitFor(
    (m) => m.t === "WalletUpdate",
    10000,
    "WalletUpdate after claim",
  );
  const aWildBefore = a.wallet?.wild ?? 0;
  const claimA = await a.exchange({ t: "Claim", d: { venue: v1.venue } }, "claim A");
  if (!claimA.ok) throw new Error("A claim failed: " + claimA.error);
  await aWalletP;
  if ((a.wallet?.wild ?? 0) !== aWildBefore + 48) {
    throw new Error(`A wallet should gain 48 MILD: ${aWildBefore} -> ${a.wallet?.wild}`);
  }
  const bIronBefore = b.invCount("Iron");
  const claimB = await b.exchange({ t: "Claim", d: { venue: v1.venue } }, "claim B");
  if (!claimB.ok) throw new Error("B claim failed: " + claimB.error);
  await sleep(300);
  if (b.invCount("Iron") !== bIronBefore + 5) throw new Error("B did not receive claimed iron");
  if (a.inboxAt(v1.venue) || b.inboxAt(v1.venue)) {
    throw new Error("inboxes should be empty after claims");
  }
  log("PASS claims: A wallet +48 MILD (WalletUpdate), B backpack +5 IRON (InventoryUpdate)");

  // ---- 6. Cancel refunds escrow ------------------------------------------
  const ironBeforeCancel = a.invCount("Iron");
  const res3 = await a.place(v1.venue, IRON, "Ask", 999, 2);
  if (!res3.ok) throw new Error("cancel-test ask failed: " + res3.error);
  await sleep(300);
  const resting = a.my.orders.find((o) => o.price === 999);
  if (!resting) throw new Error("cancel-test ask not in MyExchangeState");
  if (a.invCount("Iron") !== ironBeforeCancel - 2) throw new Error("iron not escrowed for cancel test");
  const cancel = await a.exchange({ t: "Cancel", d: { order_id: resting.id } }, "cancel");
  if (!cancel.ok) throw new Error("cancel failed: " + cancel.error);
  await sleep(300);
  if (a.invCount("Iron") !== ironBeforeCancel) throw new Error("iron not refunded on cancel");
  if (a.my.orders.some((o) => o.id === resting.id)) throw new Error("cancelled order still open");
  log("PASS cancel: resting ask cancelled, 2 IRON escrow refunded");

  // ---- 7. Venue independence (arbitrage surface) --------------------------
  // Haul iron to venue 2 and trade at a different price; venue 1's last
  // price must be untouched.
  a.tp(v2.x + 1, v2.z);
  b.tp(v2.x + 1, v2.z + 1);
  await sleep(500);
  const res4 = await a.place(v2.venue, IRON, "Ask", 20, 2);
  if (!res4.ok) throw new Error("venue-2 ask failed: " + res4.error);
  const res5 = await b.place(v2.venue, IRON, "Bid", 20, 2);
  if (!res5.ok) throw new Error("venue-2 bid failed: " + res5.error);
  await sleep(400);

  // Force a fresh markets snapshot and check the per-venue breakdown.
  const marketsP2 = a.waitFor((m) => m.t === "MarketsState", 10000, "MarketsState (refresh)");
  a.send({ t: "MarketsSub", d: { on: true } });
  const markets2 = (await marketsP2).d;
  const ironRow = markets2.rows.find((r) => r.ticker === "IRON");
  const v1Line = ironRow?.venues.find((v) => v.venue === v1.venue);
  const v2Line = ironRow?.venues.find((v) => v.venue === v2.venue);
  if (v1Line?.last !== 10) throw new Error(`venue 1 last should stay 10: ${JSON.stringify(v1Line)}`);
  if (v2Line?.last !== 20) throw new Error(`venue 2 last should be 20: ${JSON.stringify(v2Line)}`);
  if (ironRow.volume_24h_units < 7) {
    throw new Error(`IRON 24h volume should cover both trades (>=7), got ${ironRow.volume_24h_units}`);
  }
  log(
    `PASS venue independence: ${v1.name} last=10, ${v2.name} last=20 on the same ticker;`,
    `IRON 24h volume ${ironRow.volume_24h_units} units / ${ironRow.volume_24h_wild} WILD`,
  );

  // Claim the venue-2 settlements so nothing is left in flight.
  await a.exchange({ t: "Claim", d: { venue: v2.venue } }, "claim A v2");
  await b.exchange({ t: "Claim", d: { venue: v2.venue } }, "claim B v2");

  // ---- 8. Agent activity (best effort) ------------------------------------
  // Agents route to terminals and work the books on their own cadence; a
  // freshly seeded world can need several minutes of warmup, so this leg
  // reports rather than fails.
  let agentLife = null;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline && !agentLife) {
    const p = a.waitFor((m) => m.t === "MarketsState", 10000, "MarketsState (agents)");
    a.send({ t: "MarketsSub", d: { on: true } });
    const snap = (await p).d;
    agentLife = snap.rows.find(
      (r) =>
        r.ticker !== "IRON" &&
        (r.best_bid > 0 || r.best_ask > 0 || r.volume_24h_units > 0),
    );
    if (!agentLife) await sleep(10000);
  }
  if (agentLife) {
    log(
      `PASS agent activity: ${agentLife.ticker} shows non-player orders`,
      `(bid ${agentLife.best_bid} / ask ${agentLife.best_ask} / vol ${agentLife.volume_24h_units})`,
    );
  } else {
    log("SKIP agent activity: no non-IRON book life within 2 min (agents still warming up)");
  }

  log("ALL EXCHANGE E2E CHECKS PASSED");
  a.ws.close();
  b.ws.close();
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("FAILED:", e.message);
    process.exit(1);
  },
);
