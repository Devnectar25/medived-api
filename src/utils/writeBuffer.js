// Groups fire-and-forget log rows into one multi-row write per second, so logging does not
// compete with user requests for database connections.
const FLUSH_MS = 1000;
const MAX_ROWS = 200;
const MAX_QUEUED = 5000;

exports.createWriteBuffer = (name, writeRows) => {
    let queue = [];
    let timer = null;

    const flush = async () => {
        clearTimeout(timer);
        timer = null;
        const rows = queue;
        queue = [];
        for (let i = 0; i < rows.length; i += MAX_ROWS) {
            const batch = rows.slice(i, i + MAX_ROWS);
            try {
                await writeRows(batch);
            } catch (err) {
                // One bad row fails the whole statement, so save the others one by one
                console.error(`[${name}] batch of ${batch.length} failed:`, err.message);
                if (batch.length === 1) continue;
                for (const row of batch) {
                    await writeRows([row]).catch((e) => console.error(`[${name}] row failed:`, e.message));
                }
            }
        }
    };

    return {
        flush,
        push: (row) => {
            if (queue.length >= MAX_QUEUED) return Promise.resolve();
            queue.push(row);
            // Serverless instances may be frozen after the response, so write immediately there
            if (process.env.VERCEL) return flush();
            if (!timer) timer = setTimeout(flush, FLUSH_MS);
            return Promise.resolve();
        }
    };
};
