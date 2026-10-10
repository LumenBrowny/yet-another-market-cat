using System.Globalization;
using System.Numerics;
using System.Text.Json;

namespace YetAnotherCat.Accounting;

public sealed record Tier(string Id, string MinimumBaseUnits, string RateUnits);
public sealed record Transition(long Time, BigInteger Locked, long Slot, int TransactionIndex, int EventIndex);
public static class Points
{
    public const int Scale = 1000;
    public static readonly IReadOnlyList<Tier> Tiers = LoadTiers();
    private static Tier[] LoadTiers()
    {
        using var stream = typeof(Points).Assembly.GetManifestResourceStream("YetAnotherCat.Accounting.mining-tiers.json")!;
        return JsonSerializer.Deserialize<Tier[]>(stream, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
    }
    public static BigInteger Integer(string value) => BigInteger.Parse(value, CultureInfo.InvariantCulture);
    public static Tier TierFor(BigInteger locked)
    {
        if (locked < 0 || locked > ulong.MaxValue) throw new ArgumentOutOfRangeException(nameof(locked));
        return Tiers.Last(t => locked >= Integer(t.MinimumBaseUnits));
    }
    public static BigInteger Accrue(BigInteger rate, long start, long end) => rate * BigInteger.Max(0, (BigInteger)end - start);
    // Ordered chain transitions. Regressing timestamps clamp to prior transition time.
    // [start,end): an event at end contributes nothing to this interval.
    public static BigInteger CalculatePoints(IEnumerable<Transition> transitions, long start, long end)
    {
        if (start < 0 || end < start) throw new ArgumentOutOfRangeException(nameof(end));
        BigInteger result = 0, rate = 0;
        long previous = 0;
        foreach (var t in transitions.OrderBy(t => t.Slot).ThenBy(t => t.TransactionIndex).ThenBy(t => t.EventIndex))
        {
            if (t.Time < 0) throw new ArgumentOutOfRangeException(nameof(transitions));
            var time = Math.Max(previous, t.Time);
            result += Accrue(rate, Math.Max(start, previous), Math.Min(end, time));
            previous = time;
            rate = Integer(TierFor(t.Locked).RateUnits);
        }
        return result + Accrue(rate, Math.Max(start, previous), end);
    }
    public static string Format(BigInteger units, int decimals = 3)
    {
        var scale = BigInteger.Pow(10, decimals);
        var fraction = (units % scale).ToString(CultureInfo.InvariantCulture).PadLeft(decimals, '0').TrimEnd('0');
        return (units / scale).ToString(CultureInfo.InvariantCulture) + (fraction.Length > 0 ? "." + fraction : "");
    }
}
