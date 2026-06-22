using System.Collections.Concurrent;
using NAudio.Wave;

sealed class BlockingWaveProvider : IWaveProvider, IDisposable
{
    private const int QueueCapacity = 256;
    private readonly BlockingCollection<byte[]> chunks =
        new(new ConcurrentQueue<byte[]>(), QueueCapacity);
    private byte[]? currentChunk;
    private int currentOffset;
    private bool disposed;

    public BlockingWaveProvider(WaveFormat waveFormat)
    {
        WaveFormat = waveFormat;
    }

    public WaveFormat WaveFormat { get; }

    public void AddSamples(byte[] buffer, int offset, int count)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        if (count <= 0)
        {
            return;
        }

        var copy = GC.AllocateUninitializedArray<byte>(count);
        Buffer.BlockCopy(buffer, offset, copy, 0, count);
        if (!chunks.TryAdd(copy, TimeSpan.FromSeconds(2)))
        {
            throw new InvalidOperationException("AAC encoder did not consume system audio in time.");
        }
    }

    public void AddSilence(int count)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        var remaining = count;
        var chunkSize = Math.Max(
            WaveFormat.BlockAlign,
            32768 / WaveFormat.BlockAlign * WaveFormat.BlockAlign
        );

        while (remaining > 0)
        {
            var nextSize = Math.Min(remaining, chunkSize);
            if (!chunks.TryAdd(new byte[nextSize], TimeSpan.FromSeconds(2)))
            {
                throw new InvalidOperationException(
                    "AAC encoder did not consume timeline silence in time."
                );
            }
            remaining -= nextSize;
        }
    }

    public int Read(byte[] buffer, int offset, int count)
    {
        var written = 0;

        while (written < count)
        {
            if (currentChunk is null || currentOffset >= currentChunk.Length)
            {
                currentChunk = null;
                currentOffset = 0;
                if (!chunks.TryTake(out currentChunk, Timeout.Infinite))
                {
                    break;
                }
            }

            var available = currentChunk.Length - currentOffset;
            var copyCount = Math.Min(count - written, available);
            Buffer.BlockCopy(currentChunk, currentOffset, buffer, offset + written, copyCount);
            currentOffset += copyCount;
            written += copyCount;
        }

        return written;
    }

    public void Complete()
    {
        if (!chunks.IsAddingCompleted)
        {
            chunks.CompleteAdding();
        }
    }

    public void Dispose()
    {
        if (disposed)
        {
            return;
        }

        disposed = true;
        Complete();
        chunks.Dispose();
    }
}
