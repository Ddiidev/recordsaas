using System.Diagnostics;

sealed class TimelineWaveWriter : IDisposable
{
    private static readonly TimeSpan GapTolerance = TimeSpan.FromMilliseconds(50);
    private readonly BlockingWaveProvider provider;
    private readonly Stopwatch stopwatch = new();
    private readonly object sync = new();
    private long skipBytesRemaining;
    private TimeSpan? lastCallbackAt;
    private bool completed;

    public TimelineWaveWriter(BlockingWaveProvider provider, int skipInitialMs)
    {
        this.provider = provider;
        skipBytesRemaining = DurationToBytes(TimeSpan.FromMilliseconds(skipInitialMs));
    }

    public TimeSpan Elapsed => stopwatch.Elapsed;

    public void Start()
    {
        stopwatch.Restart();
    }

    public void WriteAudio(byte[] buffer, int offset, int count, TimeSpan callbackAt)
    {
        lock (sync)
        {
            ObjectDisposedException.ThrowIf(completed, this);
            var audioDuration = BytesToDuration(count);
            var gap = lastCallbackAt.HasValue
                ? callbackAt - lastCallbackAt.Value - audioDuration
                : callbackAt - audioDuration;

            if (gap > GapTolerance)
            {
                WriteSilence(DurationToBytes(gap));
            }

            WriteSamples(buffer, offset, count);
            lastCallbackAt = callbackAt;
        }
    }

    public void Complete(TimeSpan completedAt)
    {
        lock (sync)
        {
            if (completed)
            {
                return;
            }

            var trailingGap = lastCallbackAt.HasValue
                ? completedAt - lastCallbackAt.Value
                : completedAt;
            if (trailingGap > TimeSpan.Zero)
            {
                WriteSilence(DurationToBytes(trailingGap));
            }

            completed = true;
            provider.Complete();
        }
    }

    public void Dispose()
    {
        Complete(stopwatch.Elapsed);
    }

    private void WriteSamples(byte[] buffer, int offset, int count)
    {
        var skipCount = (int)Math.Min(skipBytesRemaining, count);
        skipCount -= skipCount % provider.WaveFormat.BlockAlign;
        skipBytesRemaining -= skipCount;
        offset += skipCount;
        count -= skipCount;

        if (count > 0)
        {
            provider.AddSamples(buffer, offset, count);
        }
    }

    private void WriteSilence(long count)
    {
        var skipCount = Math.Min(skipBytesRemaining, count);
        skipBytesRemaining -= skipCount;
        count -= skipCount;

        while (count > 0)
        {
            var nextCount = (int)Math.Min(count, int.MaxValue);
            nextCount -= nextCount % provider.WaveFormat.BlockAlign;
            if (nextCount <= 0)
            {
                break;
            }
            provider.AddSilence(nextCount);
            count -= nextCount;
        }
    }

    private long DurationToBytes(TimeSpan duration)
    {
        var rawBytes = duration.TotalSeconds * provider.WaveFormat.AverageBytesPerSecond;
        var alignedBytes =
            (long)Math.Round(rawBytes / provider.WaveFormat.BlockAlign) *
            provider.WaveFormat.BlockAlign;
        return Math.Max(0, alignedBytes);
    }

    private TimeSpan BytesToDuration(int count)
    {
        return TimeSpan.FromSeconds(
            (double)count / provider.WaveFormat.AverageBytesPerSecond
        );
    }
}
