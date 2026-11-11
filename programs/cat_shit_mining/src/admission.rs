use crate::*;

// The runtime verifies the issuer signature over the entire transaction message:
// program, accounts, wave, subject, expiry and recent blockhash are all bound.
// No arbitrary client transaction is ever signed by the admission service.
pub fn claim_admitted(
    ctx: Context<ClaimAdmittedFaucet>,
    wave: u8,
    subject: Pubkey,
    expires_at: i64,
) -> Result<()> {
    let c = &mut ctx.accounts.config;
    require!(c.launch_mode, SettlementError::AdmissionRequired);
    c.require_deposit_open()?;
    let now = Clock::get()?.unix_timestamp;
    let actual_wave = if now < c.wave_two_at { 1 } else { 2 };
    require!(
        wave == actual_wave
            && expires_at > now
            && expires_at <= now.checked_add(300).ok_or(MiningError::Overflow)?,
        SettlementError::InvalidAdmission
    );
    require!(
        (wave == 1 && subject != Pubkey::default())
            || (wave == 2 && subject == ctx.accounts.owner.key()),
        SettlementError::InvalidAdmission
    );
    const GRANT: u64 = 1_000_000_000;
    let next = c
        .faucet_distributed
        .checked_add(GRANT)
        .ok_or(MiningError::Overflow)?;
    require!(next <= FAUCET_GLOBAL_CAP, MiningError::FaucetExhausted);
    let bump = [c.bump];
    let seeds: &[&[u8]] = &[b"config", &bump];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.faucet_vault.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.owner_tokens.to_account_info(),
                authority: c.to_account_info(),
            },
            &[seeds],
        ),
        GRANT,
        CATSHIT_DECIMALS,
    )?;
    c.faucet_distributed = next;
    ctx.accounts.receipt.owner = ctx.accounts.owner.key();
    ctx.accounts.admission_receipt.owner = ctx.accounts.owner.key();
    ctx.accounts.admission_receipt.subject = subject;
    ctx.accounts.admission_receipt.wave = wave;
    emit!(FaucetClaimed {
        owner: ctx.accounts.owner.key(),
        amount: GRANT,
        timestamp: now
    });
    Ok(())
}
#[account]
#[derive(InitSpace)]
pub struct AdmissionReceipt {
    pub owner: Pubkey,
    pub subject: Pubkey,
    pub wave: u8,
}
#[derive(Accounts)]
#[instruction(wave: u8, subject: Pubkey)]
pub struct ClaimAdmittedFaucet<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(address=config.faucet_issuer)]
    pub issuer: Signer<'info>,
    #[account(mut, seeds=[b"config"], bump=config.bump, has_one=token_mint)]
    pub config: Account<'info, Config>,
    pub token_mint: Account<'info, Mint>,
    #[account(init, payer=owner, space=8+FaucetReceipt::INIT_SPACE, seeds=[b"faucet", owner.key().as_ref()], bump)]
    pub receipt: Account<'info, FaucetReceipt>,
    #[account(init, payer=owner, space=8+AdmissionReceipt::INIT_SPACE, seeds=[b"admission".as_ref(), &[wave], subject.as_ref()], bump)]
    pub admission_receipt: Account<'info, AdmissionReceipt>,
    #[account(mut, seeds=[b"faucet_vault"], bump, token::mint=token_mint, token::authority=config)]
    pub faucet_vault: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint=token_mint, associated_token::authority=owner)]
    pub owner_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
