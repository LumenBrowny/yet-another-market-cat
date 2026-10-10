namespace YetAnotherCat.Infrastructure;

public static class RecoveryPolicy
{
    public static bool IsVerification(string command) => command is "verify-chain" or "verify-before-publish" or "verify-batch";
    public static int TimeoutSeconds(string command, string? value) => !IsVerification(command) ? 180 : Parse(value, 900, 60, 3600);
    public static int DelaySeconds(string? value) => Parse(value, 5, 0, 300);
    private static int Parse(string? value, int fallback, int min, int max) => value == null ? fallback : int.TryParse(value, out var n) && n >= min && n <= max ? n : throw new InvalidOperationException("Invalid verification/recovery configuration");
    public static ulong Backlog(ulong current, ulong next) => current > next ? current - next : 0;
    public static void RequireValid(string? result) { if (result != "VALID") throw new InvalidOperationException("Independent verification did not pass; recovery stopped"); }
}
