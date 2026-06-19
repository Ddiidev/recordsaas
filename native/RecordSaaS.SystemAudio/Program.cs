using System.Text.Json;
using NAudio.CoreAudioApi;
using NAudio.Wave;

static int PrintUsage()
{
    Console.Error.WriteLine("Usage: recordsaas-system-audio.exe <output-wav-path> [--probe]");
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

if (args.Length == 1 && string.Equals(args[0], "--probe", StringComparison.OrdinalIgnoreCase))
{
    var device = GetDefaultRenderDevice();
    if (device is null)
    {
        Console.Error.WriteLine("No default render device found.");
        return 2;
    }

    using var probeCapture = new WasapiLoopbackCapture(device);
    var probe = new
    {
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

if (args.Length != 1 || (!string.Equals(args[0], "--stdout", StringComparison.OrdinalIgnoreCase) && args[0].StartsWith("--", StringComparison.Ordinal)))
{
    return PrintUsage();
}

var renderDevice = GetDefaultRenderDevice();
if (renderDevice is null)
{
    Console.Error.WriteLine("No default render device found.");
    return 4;
}

using var loopbackCapture = new WasapiLoopbackCapture(renderDevice);
var useStdout = string.Equals(args[0], "--stdout", StringComparison.OrdinalIgnoreCase);
var outputPath = useStdout ? null : Path.GetFullPath(args[0]);
WaveFileWriter? writer = null;
Stream? stdout = null;
var readyAnnounced = false;

void AnnounceReady()
{
    if (readyAnnounced)
    {
        return;
    }

    readyAnnounced = true;
    Console.Error.WriteLine("READY");
    Console.Error.Flush();
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
        if (useStdout)
        {
            stdout!.Write(eventArgs.Buffer, 0, eventArgs.BytesRecorded);
        }
        else
        {
            writer!.Write(eventArgs.Buffer, 0, eventArgs.BytesRecorded);
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
