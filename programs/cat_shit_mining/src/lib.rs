use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, TransferChecked},
};
pub mod settlement;
pub use settlement::*;

declare_id!("BfNiASrYNqmARu2TQ1eBa1PJ6KgVHTNn44ATk5rJe6zW");

// Mirrored by packages/shared; tests/shared.test.ts checks these values.
pub const CATSHIT_DECIMALS: u8 = 6;
pub const MIN_LOCK: u64 = 1_000_000_000;
pub const UNLOCK_COOLDOWN: i64 = 86_400;
pub const FAUCET_GLOBAL_CAP: u64 = 1_000_000_000_000;
pub const FAUCET_AMOUNT_PER_WALLET: u64 = 2_000_000_000;

#[program]
pub mod cat_shit_mining {
    use super::*;
    pub fn initialize_rewards(
        ctx: Context<InitializeRewards>,
        genesis: i64,
        duration: i64,
        emission: u64,
        publisher: Pubkey,
    ) -> Result<()> {
        settlement::initialize(ctx, genesis, duration, emission, publisher)
    }
    pub fn publish_cycle(
        ctx: Context<PublishCycle>,
        cycle_id: u64,
        root: [u8; 32],
        manifest_hash: [u8; 32],
        total_points: [u8; 32],
        total_allocated: u64,
        leaf_count: u32,
    ) -> Result<()> {
        settlement::publish(
            ctx,
            cycle_id,
            root,
            manifest_hash,
            total_points,
            total_allocated,
            leaf_count,
        )
    }
    pub fn claim_cycle(
        ctx: Context<ClaimCycle>,
        cycle_id: u64,
        point_units: [u8; 32],
        reward_amount: u64,
        proof: Vec<ProofNode>,
    ) -> Result<()> {
        settlement::claim(ctx, cycle_id, point_units, reward_amount, proof)
    }
    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.token_mint = ctx.accounts.token_mint.key();
        config.min_lock_amount = MIN_LOCK;
        config.unlock_cooldown_seconds = UNLOCK_COOLDOWN;
        config.bump = ctx.bumps.config;
        config.faucet_distributed = 0;
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.admin_tokens.to_account_info(),
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.faucet_vault.to_account_info(),
                    authority: ctx.accounts.admin.to_account_info(),
                },
            ),
            FAUCET_GLOBAL_CAP,
            CATSHIT_DECIMALS,
        )?;
        Ok(())
    }
    pub fn create_position(ctx: Context<CreatePosition>) -> Result<()> {
        let p = &mut ctx.accounts.position;
        p.owner = ctx.accounts.owner.key();
        p.created_at = Clock::get()?.unix_timestamp;
        p.bump = ctx.bumps.position;
        emit!(PositionCreated {
            owner: p.owner,
            timestamp: p.created_at
        });
        Ok(())
    }
    pub fn deposit(ctx: Context<MoveTokens>, amount: u64) -> Result<()> {
        require!(amount > 0, MiningError::ZeroAmount);
        let p = &mut ctx.accounts.position;
        let next = p
            .locked_amount
            .checked_add(amount)
            .ok_or(MiningError::Overflow)?;
        next.checked_add(p.pending_withdraw_amount)
            .ok_or(MiningError::Overflow)?;
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.owner_tokens.to_account_info(),
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
            CATSHIT_DECIMALS,
        )?;
        p.locked_amount = next;
        emit!(Deposited {
            owner: p.owner,
            amount,
            effective_locked_amount: p.locked_amount,
            timestamp: Clock::get()?.unix_timestamp
        });
        Ok(())
    }
    pub fn request_withdraw(ctx: Context<RequestWithdraw>, amount: u64) -> Result<()> {
        let p = &mut ctx.accounts.position;
        require!(amount > 0, MiningError::ZeroAmount);
        require!(
            p.pending_withdraw_amount == 0,
            MiningError::WithdrawalPending
        );
        require!(amount <= p.locked_amount, MiningError::InsufficientLocked);
        p.locked_amount = p
            .locked_amount
            .checked_sub(amount)
            .ok_or(MiningError::Overflow)?;
        p.pending_withdraw_amount = amount;
        p.withdraw_requested_at = Clock::get()?.unix_timestamp;
        emit!(WithdrawRequested {
            owner: p.owner,
            amount,
            effective_locked_amount: p.locked_amount,
            timestamp: p.withdraw_requested_at
        });
        Ok(())
    }
    pub fn execute_withdraw(ctx: Context<MoveTokens>) -> Result<()> {
        let p = &ctx.accounts.position;
        let amount = p.pending_withdraw_amount;
        require!(amount > 0, MiningError::NoWithdrawal);
        let now = Clock::get()?.unix_timestamp;
        let unlock_at = p
            .withdraw_requested_at
            .checked_add(ctx.accounts.config.unlock_cooldown_seconds)
            .ok_or(MiningError::Overflow)?;
        require!(now >= unlock_at, MiningError::Cooldown);
        let owner = p.owner;
        let bump = [p.bump];
        let seeds: &[&[u8]] = &[b"position", owner.as_ref(), &bump];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.owner_tokens.to_account_info(),
                    authority: p.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            CATSHIT_DECIMALS,
        )?;
        let p = &mut ctx.accounts.position;
        p.pending_withdraw_amount = 0;
        p.withdraw_requested_at = 0;
        emit!(WithdrawExecuted {
            owner,
            amount,
            effective_locked_amount: p.locked_amount,
            timestamp: now
        });
        Ok(())
    }
    /// Dev bootstrap distribution. Fixed inventory, no mint authority, one permanent receipt per owner.
    pub fn claim_faucet(ctx: Context<ClaimFaucet>) -> Result<()> {
        let c = &ctx.accounts.config;
        let next = c
            .faucet_distributed
            .checked_add(FAUCET_AMOUNT_PER_WALLET)
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
            FAUCET_AMOUNT_PER_WALLET,
            CATSHIT_DECIMALS,
        )?;
        ctx.accounts.config.faucet_distributed = next;
        ctx.accounts.receipt.owner = ctx.accounts.owner.key();
        emit!(FaucetClaimed {
            owner: ctx.accounts.owner.key(),
            amount: FAUCET_AMOUNT_PER_WALLET,
            timestamp: Clock::get()?.unix_timestamp
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, crate::program::CatShitMining>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ MiningError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(constraint = token_mint.decimals == CATSHIT_DECIMALS @ MiningError::InvalidMint,
        constraint = (token_mint.supply == FAUCET_GLOBAL_CAP || token_mint.supply == TOTAL_SUPPLY) @ MiningError::InvalidMint,
        constraint = token_mint.mint_authority.is_none() @ MiningError::InvalidMint,
        constraint = token_mint.freeze_authority.is_none() @ MiningError::InvalidMint)]
    pub token_mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = token_mint, associated_token::authority = admin)]
    pub admin_tokens: Account<'info, TokenAccount>,
    #[account(init, payer = admin, seeds = [b"faucet_vault"], bump, token::mint = token_mint, token::authority = config)]
    pub faucet_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct CreatePosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = token_mint)]
    pub config: Account<'info, Config>,
    pub token_mint: Account<'info, Mint>,
    #[account(init, payer = owner, space = 8 + MiningPosition::INIT_SPACE, seeds = [b"position", owner.key().as_ref()], bump)]
    pub position: Account<'info, MiningPosition>,
    #[account(init, payer = owner, seeds = [b"vault", position.key().as_ref()], bump, token::mint = token_mint, token::authority = position)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct MoveTokens<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = token_mint)]
    pub config: Account<'info, Config>,
    pub token_mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"position", owner.key().as_ref()], bump = position.bump, has_one = owner)]
    pub position: Account<'info, MiningPosition>,
    #[account(mut, seeds = [b"vault", position.key().as_ref()], bump, token::mint = token_mint, token::authority = position)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = token_mint, associated_token::authority = owner)]
    pub owner_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
#[derive(Accounts)]
pub struct RequestWithdraw<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"position", owner.key().as_ref()], bump = position.bump, has_one = owner)]
    pub position: Account<'info, MiningPosition>,
}
#[derive(Accounts)]
pub struct ClaimFaucet<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = token_mint)]
    pub config: Account<'info, Config>,
    pub token_mint: Account<'info, Mint>,
    #[account(init, payer = owner, space = 8 + FaucetReceipt::INIT_SPACE, seeds = [b"faucet", owner.key().as_ref()], bump)]
    pub receipt: Account<'info, FaucetReceipt>,
    #[account(mut, seeds = [b"faucet_vault"], bump, token::mint = token_mint, token::authority = config)]
    pub faucet_vault: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = token_mint, associated_token::authority = owner)]
    pub owner_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub token_mint: Pubkey,
    pub min_lock_amount: u64,
    pub unlock_cooldown_seconds: i64,
    pub bump: u8,
    pub faucet_distributed: u64,
}
#[account]
#[derive(InitSpace)]
pub struct MiningPosition {
    pub owner: Pubkey,
    /// Effective mining amount; excludes pending withdrawals.
    pub locked_amount: u64,
    pub created_at: i64,
    pub pending_withdraw_amount: u64,
    /// Zero when pending_withdraw_amount is zero. Amount is the authoritative sentinel.
    pub withdraw_requested_at: i64,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct FaucetReceipt {
    pub owner: Pubkey,
}

#[event]
pub struct PositionCreated {
    pub owner: Pubkey,
    pub timestamp: i64,
}
#[event]
pub struct Deposited {
    pub owner: Pubkey,
    pub amount: u64,
    pub effective_locked_amount: u64,
    pub timestamp: i64,
}
#[event]
pub struct WithdrawRequested {
    pub owner: Pubkey,
    pub amount: u64,
    pub effective_locked_amount: u64,
    pub timestamp: i64,
}
#[event]
pub struct WithdrawExecuted {
    pub owner: Pubkey,
    pub amount: u64,
    pub effective_locked_amount: u64,
    pub timestamp: i64,
}
#[event]
pub struct FaucetClaimed {
    pub owner: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[error_code]
pub enum MiningError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("A withdrawal is already pending")]
    WithdrawalPending,
    #[msg("Amount exceeds effective locked balance")]
    InsufficientLocked,
    #[msg("No pending withdrawal")]
    NoWithdrawal,
    #[msg("Withdrawal cooldown has not elapsed (24 hours)")]
    Cooldown,
    #[msg("Dev faucet allocation is exhausted")]
    FaucetExhausted,
    #[msg("Only the program upgrade authority can initialize")]
    Unauthorized,
    #[msg("Dev mint must have 6 decimals, fixed capped supply, and no mint/freeze authority")]
    InvalidMint,
}
