use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{constants::*, error::ArgusError, state::Vault};

/// The single place where tokens leave the vault ATA (INV-1).
///
/// Checks `amount > 0` and the balance before transferring (INV-10, D2), and
/// uses `transfer_checked` with the mint's decimals (D3). The vault PDA signs.
pub fn transfer_out_of_vault<'info>(
    vault: &Account<'info, Vault>,
    vault_token: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    destination: AccountInfo<'info>,
    token_program: &Interface<'info, TokenInterface>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, ArgusError::InvalidAmount);
    require!(vault_token.amount >= amount, ArgusError::InsufficientFunds);
    require_keys_neq!(
        destination.key(),
        vault_token.key(),
        ArgusError::InvalidDestination
    );

    let vault_id = vault.vault_id.to_le_bytes();
    let bump = [vault.bump];
    let seeds: &[&[u8]] = &[VAULT_SEED, vault.creator.as_ref(), &vault_id, &bump];
    let signer: &[&[&[u8]]] = &[seeds];

    transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault_token.to_account_info(),
                mint: mint.to_account_info(),
                to: destination,
                authority: vault.to_account_info(),
            },
            signer,
        ),
        amount,
        mint.decimals,
    )
}

pub fn now() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}
