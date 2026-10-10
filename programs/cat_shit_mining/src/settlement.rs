use crate::*;
use solana_sha256_hasher::hashv;

pub const TOTAL_SUPPLY: u64 = 100_000_000_000_000;
pub const REWARD_RESERVE: u64 = TOTAL_SUPPLY - FAUCET_GLOBAL_CAP;
pub const DEFAULT_CYCLE_DURATION: i64 = 86_400;
pub const DEFAULT_CYCLE_EMISSION: u64 = 100_000_000_000;
pub const MAX_PROOF_DEPTH: usize = 16;

#[account]
#[derive(InitSpace)]
pub struct RewardConfig {
    pub token_mint: Pubkey,
    pub publisher: Pubkey,
    pub genesis: i64,
    pub duration: i64,
    pub emission: u64,
    pub committed_unclaimed: u64,
    pub next_cycle: u64,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct ShitCycle {
    pub cycle_id: u64,
    pub start: i64,
    pub end: i64,
    pub root: [u8; 32],
    pub manifest_hash: [u8; 32],
    pub total_points: [u8; 32],
    pub budget: u64,
    pub total_allocated: u64,
    pub claimed_amount: u64,
    pub leaf_count: u32,
    pub published_at: i64,
    pub publisher: Pubkey,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct ClaimReceipt {
    pub cycle_id: u64,
    pub owner: Pubkey,
    pub reward_amount: u64,
    pub claimed_at: i64,
    pub bump: u8,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProofNode {
    pub hash: [u8; 32],
    pub left: bool,
}
pub fn leaf_hash(cycle_id: u64, wallet: &Pubkey, points: &[u8; 32], reward: u64) -> [u8; 32] {
    hashv(&[
        &[0],
        b"YAC_CYCLE_REWARD_V1",
        &cycle_id.to_le_bytes(),
        wallet.as_ref(),
        points,
        &reward.to_le_bytes(),
    ])
    .to_bytes()
}
pub fn empty_root() -> [u8; 32] {
    hashv(&[b"YAC_EMPTY_CYCLE_V1"]).to_bytes()
}
pub fn verify(mut hash: [u8; 32], proof: &[ProofNode], root: [u8; 32]) -> bool {
    if proof.len() > MAX_PROOF_DEPTH {
        return false;
    }
    for sibling in proof {
        hash = if sibling.left {
            hashv(&[&[1], &sibling.hash, &hash])
        } else {
            hashv(&[&[1], &hash, &sibling.hash])
        }
        .to_bytes();
    }
    hash == root
}
pub fn bounds(config: &RewardConfig, cycle_id: u64) -> Result<(i64, i64)> {
    let offset = i64::try_from(cycle_id)
        .map_err(|_| MiningError::Overflow)?
        .checked_mul(config.duration)
        .ok_or(MiningError::Overflow)?;
    let start = config
        .genesis
        .checked_add(offset)
        .ok_or(MiningError::Overflow)?;
    Ok((
        start,
        start
            .checked_add(config.duration)
            .ok_or(MiningError::Overflow)?,
    ))
}
pub fn initialize(
    ctx: Context<InitializeRewards>,
    genesis: i64,
    duration: i64,
    emission: u64,
    publisher: Pubkey,
) -> Result<()> {
    require!(
        genesis >= Clock::get()?.unix_timestamp
            && duration > 0
            && duration <= DEFAULT_CYCLE_DURATION
            && emission > 0
            && emission <= REWARD_RESERVE
            && publisher != Pubkey::default(),
        SettlementError::InvalidMetadata
    );
    let r = &mut ctx.accounts.rewards;
    r.token_mint = ctx.accounts.token_mint.key();
    r.publisher = publisher;
    r.genesis = genesis;
    r.duration = duration;
    r.emission = emission;
    r.bump = ctx.bumps.rewards;
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.admin_tokens.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.reward_vault.to_account_info(),
                authority: ctx.accounts.admin.to_account_info(),
            },
        ),
        REWARD_RESERVE,
        CATSHIT_DECIMALS,
    )?;
    Ok(())
}
pub fn publish(
    ctx: Context<PublishCycle>,
    cycle_id: u64,
    root: [u8; 32],
    manifest_hash: [u8; 32],
    total_points: [u8; 32],
    total_allocated: u64,
    leaf_count: u32,
) -> Result<()> {
    let r = &mut ctx.accounts.rewards;
    require!(cycle_id == r.next_cycle, SettlementError::NonSequential);
    let (start, end) = bounds(r, cycle_id)?;
    let now = Clock::get()?.unix_timestamp;
    require!(now >= end, SettlementError::CycleOpen);
    require!(
        manifest_hash != [0; 32] && leaf_count <= (1 << MAX_PROOF_DEPTH),
        SettlementError::InvalidMetadata
    );
    if leaf_count == 0 {
        require!(
            total_points == [0; 32] && total_allocated == 0 && root == empty_root(),
            SettlementError::InvalidMetadata
        );
    } else {
        require!(
            total_points != [0; 32]
                && total_allocated == r.emission
                && root != empty_root()
                && root != [0; 32],
            SettlementError::InvalidMetadata
        );
    }
    let available = ctx
        .accounts
        .reward_vault
        .amount
        .checked_sub(r.committed_unclaimed)
        .ok_or(SettlementError::Insolvent)?;
    require!(total_allocated <= available, SettlementError::Insolvent);
    r.committed_unclaimed = r
        .committed_unclaimed
        .checked_add(total_allocated)
        .ok_or(MiningError::Overflow)?;
    r.next_cycle = r.next_cycle.checked_add(1).ok_or(MiningError::Overflow)?;
    let c = &mut ctx.accounts.cycle;
    c.cycle_id = cycle_id;
    c.start = start;
    c.end = end;
    c.root = root;
    c.manifest_hash = manifest_hash;
    c.total_points = total_points;
    c.budget = r.emission;
    c.total_allocated = total_allocated;
    c.leaf_count = leaf_count;
    c.published_at = now;
    c.publisher = ctx.accounts.publisher.key();
    c.bump = ctx.bumps.cycle;
    emit!(CyclePublished {
        cycle_id,
        root,
        manifest_hash,
        reward_budget: c.budget,
        total_allocated,
        leaf_count,
        timestamp: now
    });
    Ok(())
}
pub fn claim(
    ctx: Context<ClaimCycle>,
    cycle_id: u64,
    point_units: [u8; 32],
    reward_amount: u64,
    proof: Vec<ProofNode>,
) -> Result<()> {
    let c = &mut ctx.accounts.cycle;
    require!(
        reward_amount > 0 && point_units != [0; 32] && c.leaf_count > 0,
        SettlementError::InvalidProof
    );
    require!(
        verify(
            leaf_hash(
                cycle_id,
                &ctx.accounts.owner.key(),
                &point_units,
                reward_amount
            ),
            &proof,
            c.root
        ),
        SettlementError::InvalidProof
    );
    c.claimed_amount = c
        .claimed_amount
        .checked_add(reward_amount)
        .ok_or(MiningError::Overflow)?;
    require!(
        c.claimed_amount <= c.total_allocated,
        SettlementError::Insolvent
    );
    let r = &mut ctx.accounts.rewards;
    r.committed_unclaimed = r
        .committed_unclaimed
        .checked_sub(reward_amount)
        .ok_or(SettlementError::Insolvent)?;
    let bump = [r.bump];
    let seeds: &[&[u8]] = &[b"rewards", &bump];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.reward_vault.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.owner_tokens.to_account_info(),
                authority: r.to_account_info(),
            },
            &[seeds],
        ),
        reward_amount,
        CATSHIT_DECIMALS,
    )?;
    let receipt = &mut ctx.accounts.receipt;
    receipt.cycle_id = cycle_id;
    receipt.owner = ctx.accounts.owner.key();
    receipt.reward_amount = reward_amount;
    receipt.claimed_at = Clock::get()?.unix_timestamp;
    receipt.bump = ctx.bumps.receipt;
    emit!(CycleClaimed {
        cycle_id,
        owner: receipt.owner,
        reward_amount,
        timestamp: receipt.claimed_at
    });
    Ok(())
}
#[derive(Accounts)]
pub struct InitializeRewards<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds=[b"config"], bump=config.bump, has_one=admin, has_one=token_mint)]
    pub config: Account<'info, Config>,
    #[account(constraint=token_mint.supply == TOTAL_SUPPLY @ MiningError::InvalidMint, constraint=token_mint.mint_authority.is_none() @ MiningError::InvalidMint, constraint=token_mint.freeze_authority.is_none() @ MiningError::InvalidMint)]
    pub token_mint: Account<'info, Mint>,
    #[account(init, payer=admin, space=8+RewardConfig::INIT_SPACE, seeds=[b"rewards"], bump)]
    pub rewards: Account<'info, RewardConfig>,
    #[account(init, payer=admin, seeds=[b"reward_vault"], bump, token::mint=token_mint, token::authority=rewards)]
    pub reward_vault: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint=token_mint, associated_token::authority=admin)]
    pub admin_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(cycle_id: u64)]
pub struct PublishCycle<'info> {
    #[account(mut)]
    pub publisher: Signer<'info>,
    #[account(mut, seeds=[b"rewards"], bump=rewards.bump, has_one=publisher)]
    pub rewards: Account<'info, RewardConfig>,
    #[account(seeds=[b"reward_vault"], bump, token::mint=rewards.token_mint, token::authority=rewards)]
    pub reward_vault: Account<'info, TokenAccount>,
    #[account(init, payer=publisher, space=8+ShitCycle::INIT_SPACE, seeds=[b"cycle".as_ref(), cycle_id.to_le_bytes().as_ref()], bump)]
    pub cycle: Account<'info, ShitCycle>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(cycle_id: u64)]
pub struct ClaimCycle<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds=[b"rewards"], bump=rewards.bump, has_one=token_mint)]
    pub rewards: Account<'info, RewardConfig>,
    pub token_mint: Account<'info, Mint>,
    #[account(mut, seeds=[b"cycle", &cycle_id.to_le_bytes()], bump=cycle.bump, constraint=cycle.cycle_id == cycle_id)]
    pub cycle: Account<'info, ShitCycle>,
    #[account(mut, seeds=[b"reward_vault"], bump, token::mint=token_mint, token::authority=rewards)]
    pub reward_vault: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint=token_mint, associated_token::authority=owner)]
    pub owner_tokens: Account<'info, TokenAccount>,
    #[account(init, payer=owner, space=8+ClaimReceipt::INIT_SPACE, seeds=[b"claim".as_ref(), cycle_id.to_le_bytes().as_ref(), owner.key().as_ref()], bump)]
    pub receipt: Account<'info, ClaimReceipt>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
#[event]
pub struct CyclePublished {
    pub cycle_id: u64,
    pub root: [u8; 32],
    pub manifest_hash: [u8; 32],
    pub reward_budget: u64,
    pub total_allocated: u64,
    pub leaf_count: u32,
    pub timestamp: i64,
}
#[event]
pub struct CycleClaimed {
    pub cycle_id: u64,
    pub owner: Pubkey,
    pub reward_amount: u64,
    pub timestamp: i64,
}
#[error_code]
pub enum SettlementError {
    #[msg("Invalid immutable cycle metadata")]
    InvalidMetadata,
    #[msg("Cycles must be published sequentially")]
    NonSequential,
    #[msg("Cycle has not ended")]
    CycleOpen,
    #[msg("Reward reserve or cycle allocation would be overdrawn")]
    Insolvent,
    #[msg("Invalid reward proof")]
    InvalidProof,
}

#[cfg(test)]
mod golden_tests {
    use super::*;
    use std::str::FromStr;

    fn bytes(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }
    fn hash(s: &str) -> [u8; 32] {
        bytes(s).try_into().unwrap()
    }

    #[test]
    fn shared_cross_language_vectors() {
        let vectors: serde_json::Value =
            serde_json::from_str(include_str!("../../../protocol/settlement-vectors.json"))
                .unwrap();
        for vector in vectors.as_array().unwrap() {
            let canonical = vector["canonical"].as_str().unwrap();
            assert_eq!(
                hashv(&[canonical.as_bytes()]).to_bytes(),
                hash(vector["manifestHash"].as_str().unwrap())
            );
            let root = hash(vector["manifest"]["merkleRoot"].as_str().unwrap());
            let leaves = vector["leaves"].as_array().unwrap();
            if leaves.is_empty() {
                assert_eq!(root, empty_root());
            }
            for leaf in leaves {
                let preimage = bytes(leaf["preimage"].as_str().unwrap());
                let wallet = Pubkey::from_str(leaf["wallet"].as_str().unwrap()).unwrap();
                let mut points = [0u8; 32];
                points[16..].copy_from_slice(
                    &leaf["pointUnits"]
                        .as_str()
                        .unwrap()
                        .parse::<u128>()
                        .unwrap()
                        .to_be_bytes(),
                );
                let reward = leaf["rewardBaseUnits"]
                    .as_str()
                    .unwrap()
                    .parse::<u64>()
                    .unwrap();
                let expected = hash(leaf["hash"].as_str().unwrap());
                assert_eq!(hashv(&[&preimage]).to_bytes(), expected);
                assert_eq!(leaf_hash(42, &wallet, &points, reward), expected);
                let proof: Vec<ProofNode> = leaf["proof"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| ProofNode {
                        hash: hash(p["hash"].as_str().unwrap()),
                        left: p["left"].as_bool().unwrap(),
                    })
                    .collect();
                assert!(verify(expected, &proof, root));
                assert!(!verify(
                    leaf_hash(43, &wallet, &points, reward),
                    &proof,
                    root
                ));
            }
        }
        assert!(!verify(
            [0; 32],
            &vec![
                ProofNode {
                    hash: [0; 32],
                    left: false
                };
                17
            ],
            [0; 32]
        ));
    }
}
