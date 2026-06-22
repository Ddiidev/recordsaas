using System.Diagnostics;
using System.Text.Json;
using NAudio.CoreAudioApi;
using NAudio.Wave;

static int PrintUsage()
{
    Console.Error.WriteLine("Usage: recordsaas-system-audio.exe (--stdout | <output-wav-path>) [--device-id <id>]");
    Console.Error.WriteLine("       recordsaas-system-audio.exe --probe [--device-id <id>]");
    Console.Error.WriteLine("       recordsaas-system-audio.exe --probe-all");
    return 1;
}

static MMDevice? GetDefaultRenderDevice()
{
    using var enumerator = new MMDeviceEnumerator();
    try
    {
        return enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
    }
    catch
    {
        return null;
    }
}

static MMDevice? GetRenderDeviceById(string deviceId)
{
    using var enumerator = new MMDeviceEnumerator();
    try
    {
        return enumerator.GetDevice(deviceId);
    }
    catch
    {
        return null;
    }
}

static string GetSampleFormat(WaveFormat waveFormat)
{
    var encoding = waveFormat.Encoding.ToString().ToLowerInvariant();
    if (encoding.Contains("float"))
    {
        return waveFormat.BitsPerSample >= 64 ? "f64le" : "f32le";
    }

    return waveFormat.BitsPerSample switch
    {
        16 => "s16le",
        24 => "s24le",
        32 => "s32le",
        _ => "s16le",
    };
}

// Parse --device-id from args, return deviceId if found (null otherwise)
string? ParseDeviceId(string[] arguments)
{
    for (int i = 0; i < arguments.Length - 1; i++)
    {
        if (string.Equals(arguments[i], "--device-id", StringComparison.OrdinalIgnoreCase))
        {
            return arguments[i + 1];
        }
    }
    return null;
}

// --probe-all: list all active render endpoints
if (args.Length == 1 && string.Equals(args[0], "--probe-all", StringComparison.OrdinalIgnoreCase))
{
    using var enumerator = new MMDeviceEnumerator();
    var defaultDevice = GetDefaultRenderDevice();

    var devices = enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active)
        .Select(dev =>
        {
            using var cap = new WasapiLoopbackCapture(dev);
            return new
            {
                id = dev.ID,
                name = dev.FriendlyName,
                isDefault = dev.ID == defaultDevice?.ID,
                sampleRate = cap.WaveFormat.SampleRate,
                channels = cap.WaveFormat.Channels,
                bitsPerSample = cap.WaveFormat.BitsPerSample,
                sampleFormat = GetSampleFormat(cap.WaveFormat),
            };
        })
        .ToList();

    Console.WriteLine(JsonSerializer.Serialize(devices));
    return 0;
}

// --probe [--device-id <id>]: probe a specific or default render device
if (args.Any(a => string.Equals(a, "--probe", StringComparison.OrdinalIgnoreCase)))
{
    var devId = ParseDeviceId(args);
    var device = devId != null ? GetRenderDeviceById(devId) : GetDefaultRenderDevice();
    if (device is null)
    {
        Console.Error.WriteLine("No render device found.");
        return 2;
    }

    using var probeCapture = new WasapiLoopbackCapture(device);
    var probe = new
    {
        id = device.ID,
        deviceName = device.FriendlyName,
        sampleRate = probeCapture.WaveFormat.SampleRate,
        channels = probeCapture.WaveFormat.Channels,
        bitsPerSample = probeCapture.WaveFormat.BitsPerSample,
        encoding = probeCapture.WaveFormat.Encoding.ToString(),
        sampleFormat = GetSampleFormat(probeCapture.WaveFormat),
    };

    Console.WriteLine(JsonSerializer.Serialize(probe));
    return 0;
}

// Recording mode: (--stdout | <path>) [--device-id <id>]
var outputArg = args.Length > 0 ? args[0] : null;
if (outputArg is null ||
    (outputArg.StartsWith("--", StringComparison.Ordinal) &&
     !string.Equals(outputArg, "--stdout", StringComparison.OrdinalIgnoreCase)))
{
    return PrintUsage();
}

var deviceIdArg = ParseDeviceId(args);

var renderDevice = deviceIdArg != null
    ? GetRenderDeviceById(deviceIdArg)
    : GetDefaultRenderDevice();

if (renderDevice is null)
{
    Console.Error.WriteLine("No render device found.");
    return 4;
}

using var loopbackCapture = new WasapiLoopbackCapture(renderDevice);
var useStdout = string.Equals(outputArg, "--stdout", StringComparison.OrdinalIgnoreCase);
var outputPath = useStdout ? null : Path.GetFullPath(outputArg);
WaveFileWriter? writer = null;
Stream? stdout = null;
var readyAnnounced = false;

// Gap-filling state
var sw = Stopwatch.StartNew();
var totalBytesWritten = 0L;
var gapToleranceMs = 250.0;

void AnnounceReady()
{
    if (readyAnnounced) return;
    readyAnnounced = true;
    Console.Error.WriteLine("READY");
    Console.Error.Flush();
}

void WriteBytes(byte[] buf, int offset, int count)
{
    if (useStdout)
        stdout!.Write(buf, offset, count);
    else
        writer!.Write(buf, offset, count);
    
    totalBytesWritten += count;
}

void WriteSilenceMs(double ms, int bytesPerSec, int blockAlign)
{
    var totalBytes = (long)(ms / 1000.0 * bytesPerSec);
    totalBytes -= totalBytes % blockAlign;
    if (totalBytes <= 0) return;
    const int chunkSize = 32768;
    var silence = new byte[Math.Min(chunkSize, totalBytes)];
    while (totalBytes > 0)
    {
        var toWrite = (int)Math.Min(totalBytes, silence.Length);
        WriteBytes(silence, 0, toWrite);
        totalBytes -= toWrite;
    }
}

if (!useStdout)
{
    var outputDirectory = Path.GetDirectoryName(outputPath);
    if (string.IsNullOrWhiteSpace(outputDirectory))
    {
        Console.Error.WriteLine("Invalid output path.");
        return 3;
    }

    Directory.CreateDirectory(outputDirectory);
    writer = new WaveFileWriter(outputPath, loopbackCapture.WaveFormat);
}
else
{
    stdout = Console.OpenStandardOutput();
}

var stopSignal = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
var captureStopped = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
var fatalError = default(Exception);
var writeSync = new object();

_ = Task.Run(() =>
{
    try
    {
        Console.OpenStandardInput().ReadByte();
    }
    catch (Exception ex)
    {
        fatalError ??= ex;
    }
    finally
    {
        stopSignal.TrySetResult(true);
    }
});

loopbackCapture.DataAvailable += (_, eventArgs) =>
{
    try
    {
        AnnounceReady();

        var wf = loopbackCapture.WaveFormat;
        var bytesPerSec = wf.AverageBytesPerSecond;
        var blockAlign = wf.BlockAlign;
        var audioDurationMs = eventArgs.BytesRecorded * 1000.0 / bytesPerSec;
        var nowMs = sw.Elapsed.TotalMilliseconds;

        lock (writeSync)
        {
            var expectedAudioTimeMs = totalBytesWritten * 1000.0 / bytesPerSec;
            var gapMs = (nowMs - audioDurationMs) - expectedAudioTimeMs;

            if (gapMs > gapToleranceMs)
            {
                WriteSilenceMs(gapMs, bytesPerSec, blockAlign);
            }

            WriteBytes(eventArgs.Buffer, 0, eventArgs.BytesRecorded);
        }
    }
    catch (Exception ex)
    {
        fatalError = ex;
        stopSignal.TrySetResult(true);
    }
};

loopbackCapture.RecordingStopped += (_, eventArgs) =>
{
    if (eventArgs.Exception is not null)
    {
        fatalError ??= eventArgs.Exception;
    }

    captureStopped.TrySetResult(true);
    stopSignal.TrySetResult(true);
};

try
{
    sw.Restart();
    loopbackCapture.StartRecording();
    AnnounceReady();
    await stopSignal.Task;
}
catch (OperationCanceledException)
{
    // Normal shutdown path.
}
catch (Exception ex)
{
    fatalError = ex;
}
finally
{
    if (loopbackCapture.CaptureState == CaptureState.Capturing)
    {
        loopbackCapture.StopRecording();
    }

    if (useStdout)
    {
        stdout?.Flush();
    }
    else
    {
        writer?.Dispose();
    }
}

await captureStopped.Task;

if (fatalError is not null)
{
    Console.Error.WriteLine(fatalError.Message);
    return 5;
}

return 0;
