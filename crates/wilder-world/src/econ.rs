//! Shared economy-actor plumbing.
//!
//! Players and faction agents obey the same economy rulebook; they differ
//! only in *who decides* (input vs. utility scoring). This module holds the
//! actor-agnostic pieces: the [`Currency`] index, the [`Purse`] every actor
//! carries its fungible balances in, and the [`EconActor`] handle the shared
//! economy entry points on `World` operate on.

use serde::{Deserialize, Serialize};
use wilder_types::*;

/// A minted wallet currency. Every currency has two [`Purse`] balances:
/// **carried** (at-risk, burns on death) and **banked** (death-safe).
/// Cash and Blueprint Fragments deliberately stay `ItemKind`s — lootable
/// physical carriers, not fungible balances.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Currency {
    Wild,
    Shards,
    Energy,
}

impl Currency {
    pub const ALL: [Currency; 3] = [Currency::Wild, Currency::Shards, Currency::Energy];

    /// Index into the purse arrays.
    pub fn index(self) -> usize {
        match self {
            Currency::Wild => 0,
            Currency::Shards => 1,
            Currency::Energy => 2,
        }
    }

    /// Replicated `variant` index the client uses to pick a currency
    /// pickup's look.
    pub fn variant(self) -> u32 {
        self.index() as u32
    }

    /// The ledger denomination for `amount` of this currency.
    pub fn tx_amount(self, amount: u32) -> TxAmount {
        match self {
            Currency::Wild => TxAmount::Wild { amount },
            Currency::Shards => TxAmount::Shards { amount },
            Currency::Energy => TxAmount::Energy { amount },
        }
    }
}

impl From<wilder_protocol::Currency> for Currency {
    fn from(c: wilder_protocol::Currency) -> Self {
        match c {
            wilder_protocol::Currency::Mild => Currency::Wild,
            wilder_protocol::Currency::Shards => Currency::Shards,
            wilder_protocol::Currency::Energy => Currency::Energy,
        }
    }
}

/// Every economic actor's currency balances, carried and banked, indexed by
/// [`Currency`]. One structure replaces the six loose fields players used to
/// carry (and the two agents had), so bank and death logic is written once.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Purse {
    /// At-risk balances: burn on death.
    pub carried: [u32; 3],
    /// Death-safe balances: deposited/withdrawn at a Bank.
    pub banked: [u32; 3],
}

impl Purse {
    pub fn carried(&self, c: Currency) -> u32 {
        self.carried[c.index()]
    }

    pub fn banked(&self, c: Currency) -> u32 {
        self.banked[c.index()]
    }

    pub fn credit(&mut self, c: Currency, amount: u32) {
        self.carried[c.index()] += amount;
    }

    /// Spend from the carried balance. All-or-nothing: returns false (and
    /// changes nothing) when the balance can't cover `amount`.
    pub fn debit(&mut self, c: Currency, amount: u32) -> bool {
        let slot = &mut self.carried[c.index()];
        if *slot < amount {
            return false;
        }
        *slot -= amount;
        true
    }

    /// Move up to `amount` from carried into banked; returns what moved.
    pub fn deposit(&mut self, c: Currency, amount: u32) -> u32 {
        let moved = amount.min(self.carried[c.index()]);
        self.carried[c.index()] -= moved;
        self.banked[c.index()] += moved;
        moved
    }

    /// Move up to `amount` from banked back into carried; returns what moved.
    pub fn withdraw(&mut self, c: Currency, amount: u32) -> u32 {
        let moved = amount.min(self.banked[c.index()]);
        self.banked[c.index()] -= moved;
        self.carried[c.index()] += moved;
        moved
    }

    /// Death: every carried balance burns, banked side survives. Returns the
    /// burned amounts (indexed by [`Currency`]) for the caller's ledger legs.
    pub fn burn_carried_on_death(&mut self) -> [u32; 3] {
        std::mem::take(&mut self.carried)
    }
}

/// Handle to any economic actor for the shared economy entry points on
/// `World`: a connected player (by live entity id) or a faction agent (by
/// index into `World::agents`). What differs per kind — where the purse and
/// inventory live, whether S2C notifications exist — is resolved by the
/// `World::actor_*` accessors, so vendor/bank/ledger code is written once.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EconActor {
    Player(EntityId),
    Agent(usize),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn purse_credit_debit_is_all_or_nothing() {
        let mut p = Purse::default();
        p.credit(Currency::Wild, 100);
        p.credit(Currency::Energy, 3);
        assert_eq!(p.carried(Currency::Wild), 100);
        assert_eq!(p.carried(Currency::Shards), 0);
        assert!(p.debit(Currency::Wild, 60));
        assert_eq!(p.carried(Currency::Wild), 40);
        // Overdraft refused, balance untouched.
        assert!(!p.debit(Currency::Wild, 41));
        assert_eq!(p.carried(Currency::Wild), 40);
        // Currencies never bleed into each other.
        assert!(!p.debit(Currency::Shards, 1));
        assert_eq!(p.carried(Currency::Energy), 3);
    }

    #[test]
    fn purse_bank_moves_clamp_to_the_source_balance() {
        let mut p = Purse::default();
        p.credit(Currency::Shards, 50);
        assert_eq!(p.deposit(Currency::Shards, 80), 50);
        assert_eq!(p.carried(Currency::Shards), 0);
        assert_eq!(p.banked(Currency::Shards), 50);
        assert_eq!(p.withdraw(Currency::Shards, 20), 20);
        assert_eq!(p.carried(Currency::Shards), 20);
        assert_eq!(p.banked(Currency::Shards), 30);
        // Nothing to move is a zero-op, not an error.
        assert_eq!(p.deposit(Currency::Energy, 10), 0);
        assert_eq!(p.withdraw(Currency::Energy, 10), 0);
    }

    #[test]
    fn death_burns_carried_and_spares_the_bank() {
        let mut p = Purse::default();
        p.credit(Currency::Wild, 300);
        p.credit(Currency::Energy, 7);
        p.deposit(Currency::Wild, 120);
        let burned = p.burn_carried_on_death();
        assert_eq!(burned[Currency::Wild.index()], 180);
        assert_eq!(burned[Currency::Shards.index()], 0);
        assert_eq!(burned[Currency::Energy.index()], 7);
        assert_eq!(p.carried(Currency::Wild), 0);
        assert_eq!(p.carried(Currency::Energy), 0);
        assert_eq!(p.banked(Currency::Wild), 120, "banked side survives death");
    }
}
