namespace YetAnotherCat.Api;

public static class AdmissionEndpoints
{
    private static readonly HttpClient Client = new(new SocketsHttpHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(25) };
    public static void MapAdmission(this WebApplication app)
    {
        foreach (var (path, method) in new[] { ("challenge", "POST"), ("authorize", "POST"), ("captcha-complete", "POST"), ("captcha", "GET"), ("status", "GET") })
            app.MapMethods("/api/faucet/" + path, [method], async (HttpContext ctx) =>
            {
                var secret = app.Configuration["YAC_ADMISSION_PROXY_SECRET"];
                if (app.Configuration["YAC_ADMISSION_ENABLED"] != "true" || secret?.Length < 32 || secret is null)
                { ctx.Response.StatusCode = 503; await ctx.Response.WriteAsJsonAsync(new { error = "Admission is not enabled" }); return; }
                using var request = new HttpRequestMessage(new HttpMethod(method), "http://127.0.0.1:5091/" + path + ctx.Request.QueryString);
                request.Headers.Add("X-Yamc-Admission-Secret", secret);
                request.Headers.Add("X-Yamc-Client-Ip", ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown");
                if (ctx.Request.Headers.Origin.Count == 1) request.Headers.TryAddWithoutValidation("Origin", ctx.Request.Headers.Origin.ToString());
                if (method == "POST")
                {
                    if (ctx.Request.ContentType?.Split(';')[0].Trim() != "application/json") { ctx.Response.StatusCode = 415; return; }
                    using var buffer = new MemoryStream();
                    var chunk = new byte[4096]; int count;
                    while ((count = await ctx.Request.Body.ReadAsync(chunk, ctx.RequestAborted)) > 0)
                    { if (buffer.Length + count > 16384) { ctx.Response.StatusCode = 413; return; } buffer.Write(chunk, 0, count); }
                    request.Content = new ByteArrayContent(buffer.ToArray());
                    request.Content.Headers.ContentType = new("application/json");
                }
                using var response = await Client.SendAsync(request, ctx.RequestAborted);
                ctx.Response.StatusCode = (int)response.StatusCode;
                ctx.Response.ContentType = response.Content.Headers.ContentType?.ToString() ?? "application/json";
                if (path == "captcha" && response.Headers.TryGetValues("Content-Security-Policy", out var csp)) ctx.Response.Headers.ContentSecurityPolicy = csp.Single();
                await response.Content.CopyToAsync(ctx.Response.Body, ctx.RequestAborted);
            });
    }
}
