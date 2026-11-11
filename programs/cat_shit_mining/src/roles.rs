use crate::*;

// Recovery is authorized by the offline config admin, never by the outgoing key.
// The incoming signature proves possession before the new authority takes effect.
pub fn replace_publisher(ctx: Context<RotatePublisher>) -> Result<()> {
    let old = ctx.accounts.rewards.publisher;
    let new = ctx.accounts.new_publisher.key();
    require!(
        new != old && new != Pubkey::default(),
        RoleError::InvalidReplacement
    );
    ctx.accounts.rewards.publisher = new;
    emit!(PublisherRotated {
        old,
        new,
        timestamp: Clock::get()?.unix_timestamp
    });
    Ok(())
}

pub fn replace_issuer(ctx: Context<RotateFaucetIssuer>) -> Result<()> {
    let old = ctx.accounts.config.faucet_issuer;
    let new = ctx.accounts.new_issuer.key();
    require!(
        new != old && new != Pubkey::default(),
        RoleError::InvalidReplacement
    );
    ctx.accounts.config.faucet_issuer = new;
    emit!(FaucetIssuerRotated {
        old,
        new,
        timestamp: Clock::get()?.unix_timestamp
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RotatePublisher<'info> {
    pub admin: Signer<'info>,
    pub new_publisher: Signer<'info>,
    #[account(seeds=[b"config"], bump=config.bump, has_one=admin,
        constraint=config.launch_mode @ RoleError::LaunchRequired,
        constraint=config.token_mint == rewards.token_mint)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds=[b"rewards"], bump=rewards.bump)]
    pub rewards: Account<'info, RewardConfig>,
}

#[derive(Accounts)]
pub struct RotateFaucetIssuer<'info> {
    pub admin: Signer<'info>,
    pub new_issuer: Signer<'info>,
    #[account(mut, seeds=[b"config"], bump=config.bump, has_one=admin,
        constraint=config.launch_mode && config.activated_at > 0 @ RoleError::LaunchRequired)]
    pub config: Account<'info, Config>,
}

#[event]
pub struct PublisherRotated {
    pub old: Pubkey,
    pub new: Pubkey,
    pub timestamp: i64,
}
#[event]
pub struct FaucetIssuerRotated {
    pub old: Pubkey,
    pub new: Pubkey,
    pub timestamp: i64,
}

#[error_code]
pub enum RoleError {
    #[msg("Initialized launch deployment required (issuer must be activated)")]
    LaunchRequired,
    #[msg("Replacement must be nonzero and different from current authority")]
    InvalidReplacement,
}
