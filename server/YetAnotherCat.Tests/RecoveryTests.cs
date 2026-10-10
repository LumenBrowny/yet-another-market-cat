using YetAnotherCat.Infrastructure;
using Xunit;
namespace YetAnotherCat.Tests;
public class RecoveryTests
{
    [Fact] public void LongTimeoutOnlyForIndependentVerification() {
        Assert.Equal(900,RecoveryPolicy.TimeoutSeconds("verify-chain",null));
        Assert.Equal(600,RecoveryPolicy.TimeoutSeconds("verify-before-publish","600"));
        Assert.Equal(180,RecoveryPolicy.TimeoutSeconds("publish","900"));
        Assert.Equal(180,RecoveryPolicy.TimeoutSeconds("state","900"));
        Assert.Throws<InvalidOperationException>(()=>RecoveryPolicy.TimeoutSeconds("verify-chain","-1"));
    }
    [Fact] public void BacklogDoesNotDependOnCalculatedRows() {
        Assert.Equal(157UL,RecoveryPolicy.Backlog(264,107));
        Assert.Equal(0UL,RecoveryPolicy.Backlog(107,107));
        Assert.Equal(0UL,RecoveryPolicy.Backlog(0,0));
    }
    [Theory] [InlineData("INVALID")] [InlineData("UNVERIFIABLE")] [InlineData(null)]
    public void FailureNeverPermitsNextCycle(string? result)=>Assert.Throws<InvalidOperationException>(()=>RecoveryPolicy.RequireValid(result));
}
