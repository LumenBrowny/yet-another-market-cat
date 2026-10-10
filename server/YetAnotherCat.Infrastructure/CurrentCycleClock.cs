namespace YetAnotherCat.Infrastructure;

// Published by operational state polling; API reads never trigger RPC.
public sealed class CurrentCycleClock
{
    public RewardConfiguration? Configuration { get; set; }
}
