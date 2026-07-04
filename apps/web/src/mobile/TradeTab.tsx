// Trade tab placeholder: the exchange ships in a later phase. Pure themed
// screen — no trading logic, no server subscriptions.

const TEASERS = [
  "Central market. Buy and sell anything, anywhere.",
  "Live order books and price history.",
  "Powered by the Wilder economy.",
];

export function TradeTab() {
  return (
    <div className="m-trade">
      <div className="m-trade-panel">
        <div className="m-trade-scanline" />
        <div className="m-trade-glyph">⇌</div>
        <div className="m-trade-title">TRADE HUB</div>
        <div className="m-trade-badge">COMING SOON</div>
        <div className="m-trade-teasers">
          {TEASERS.map((line) => (
            <div key={line} className="m-trade-teaser">
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
