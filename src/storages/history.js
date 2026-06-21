const fs = require('fs');
const path = require('path');

class HistoryStorage {
  constructor(options = {}) {
    this.storageDir = options.storageDir || path.join(process.cwd(), '.ms-topology-history');
    this.maxSnapshots = options.maxSnapshots || 1000;
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    const gitignorePath = path.join(this.storageDir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, '*\n!.gitignore\n', 'utf8');
    }
  }

  _getSnapshotPath(timestamp) {
    const date = new Date(timestamp);
    const dateStr = date.toISOString().replace(/[:.]/g, '-');
    return path.join(this.storageDir, `snapshot-${dateStr}.json`);
  }

  _parseTimestampFromFilename(filename) {
    const match = filename.match(/snapshot-(.+)\.json$/);
    if (!match) return null;
    let dateStr = match[1];
    const parts = dateStr.split('T');
    if (parts.length === 2) {
      const timePart = parts[1];
      const timeParts = timePart.split('-');
      if (timeParts.length === 4) {
        dateStr = `${parts[0]}T${timeParts[0]}:${timeParts[1]}:${timeParts[2]}.${timeParts[3]}`;
      }
    }
    const timestamp = new Date(dateStr).getTime();
    return isNaN(timestamp) ? null : timestamp;
  }

  saveSnapshot(analysis, source = 'unknown') {
    const timestamp = Date.now();
    const snapshot = {
      timestamp,
      timestampISO: new Date(timestamp).toISOString(),
      source,
      version: '1.0',
      summary: {
        totalServices: analysis.services.length,
        healthyCount: analysis.health.summary.healthy,
        degradedCount: analysis.health.summary.degraded,
        unhealthyCount: analysis.health.summary.unhealthy,
        overallScore: analysis.health.summary.overallScore,
        overallStatus: analysis.health.summary.overallStatus,
        criticalPathDuration: analysis.criticalPath.totalDuration,
        criticalPathLength: analysis.criticalPath.criticalPath.length,
        slowEdgeCount: analysis.performance.slowEdges.length,
        highErrorEdgeCount: analysis.performance.highErrorEdges.length
      },
      services: this._extractServiceMetrics(analysis),
      edges: this._extractEdgeMetrics(analysis)
    };

    const snapshotPath = this._getSnapshotPath(timestamp);
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');
    this._trimOldSnapshots();
    return { timestamp, path: snapshotPath, snapshot };
  }

  _extractServiceMetrics(analysis) {
    const metrics = {};
    const healthServices = analysis.health.services;
    const perfServices = analysis.performance.serviceMetrics;

    Object.entries(healthServices).forEach(([name, health]) => {
      const perf = perfServices[name] || {};
      metrics[name] = {
        healthStatus: health.healthStatus,
        score: health.score,
        instanceCount: health.instanceCount,
        cpuUsage: health.cpuUsage,
        memoryUsage: health.memoryUsage,
        avgIncomingLatency: perf.avgIncomingLatency || 0,
        avgOutgoingLatency: perf.avgOutgoingLatency || 0,
        errorRate: perf.errorRate || 0,
        totalIncomingRequests: perf.totalIncomingRequests || 0,
        totalOutgoingRequests: perf.totalOutgoingRequests || 0,
        loadIndex: perf.loadIndex || 0
      };
    });
    return metrics;
  }

  _extractEdgeMetrics(analysis) {
    const metrics = {};
    const adj = analysis.dependencies.adjacencyList;
    for (const [from, neighbors] of Object.entries(adj)) {
      for (const e of neighbors) {
        const key = `${from}→${e.service}`;
        metrics[key] = {
          from,
          to: e.service,
          avgLatency: e.avgLatency,
          p99Latency: e.p99Latency,
          errorRate: e.errorRate,
          requestCount: e.requestCount,
          circuitBreakerState: e.circuitBreaker ? e.circuitBreaker.state : null,
          hasFallback: !!e.fallback,
          hasRetry: !!e.retry
        };
      }
    }
    return metrics;
  }

  _trimOldSnapshots() {
    const files = this._listSnapshotFiles();
    if (files.length > this.maxSnapshots) {
      const toDelete = files.slice(0, files.length - this.maxSnapshots);
      toDelete.forEach(f => {
        try { fs.unlinkSync(path.join(this.storageDir, f)); } catch (e) {}
      });
    }
  }

  _listSnapshotFiles() {
    if (!fs.existsSync(this.storageDir)) return [];
    return fs.readdirSync(this.storageDir)
      .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
      .sort();
  }

  listSnapshots(options = {}) {
    const files = this._listSnapshotFiles();
    let snapshots = files.map(f => {
      const timestamp = this._parseTimestampFromFilename(f);
      return {
        filename: f,
        timestamp,
        timestampISO: new Date(timestamp).toISOString(),
        path: path.join(this.storageDir, f)
      };
    }).filter(s => s.timestamp);

    if (options.fromTime) {
      snapshots = snapshots.filter(s => s.timestamp >= options.fromTime);
    }
    if (options.toTime) {
      snapshots = snapshots.filter(s => s.timestamp <= options.toTime);
    }
    if (options.limit) {
      snapshots = snapshots.slice(-options.limit);
    }

    return snapshots.sort((a, b) => a.timestamp - b.timestamp);
  }

  loadSnapshot(timestamp) {
    const snapshotPath = this._getSnapshotPath(timestamp);
    if (!fs.existsSync(snapshotPath)) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    } catch (e) {
      return null;
    }
  }

  loadLatestSnapshot() {
    const files = this._listSnapshotFiles();
    if (files.length === 0) return null;
    const latest = files[files.length - 1];
    try {
      return JSON.parse(fs.readFileSync(path.join(this.storageDir, latest), 'utf8'));
    } catch (e) {
      return null;
    }
  }

  loadSnapshotsInRange(fromTime, toTime) {
    const snapshots = this.listSnapshots({ fromTime, toTime });
    return snapshots
      .map(s => this.loadSnapshot(s.timestamp))
      .filter(Boolean);
  }

  loadRecentSnapshots(limit = 10) {
    const files = this._listSnapshotFiles().slice(-limit);
    return files
      .map(f => {
        try {
          return JSON.parse(fs.readFileSync(path.join(this.storageDir, f), 'utf8'));
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);
  }

  getSnapshotAtTime(targetTime) {
    const snapshots = this.listSnapshots();
    if (snapshots.length === 0) return null;
    let closest = snapshots[0];
    let minDiff = Math.abs(snapshots[0].timestamp - targetTime);
    for (const s of snapshots) {
      const diff = Math.abs(s.timestamp - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = s;
      }
    }
    return this.loadSnapshot(closest.timestamp);
  }

  clearAll() {
    const files = this._listSnapshotFiles();
    files.forEach(f => {
      try { fs.unlinkSync(path.join(this.storageDir, f)); } catch (e) {}
    });
    return files.length;
  }

  getStats() {
    const files = this._listSnapshotFiles();
    const latest = files.length > 0 ? this._parseTimestampFromFilename(files[files.length - 1]) : null;
    const earliest = files.length > 0 ? this._parseTimestampFromFilename(files[0]) : null;

    let totalSize = 0;
    files.forEach(f => {
      try {
        const stat = fs.statSync(path.join(this.storageDir, f));
        totalSize += stat.size;
      } catch (e) {}
    });

    return {
      snapshotCount: files.length,
      earliestTimestamp: earliest,
      earliestISO: earliest ? new Date(earliest).toISOString() : null,
      latestTimestamp: latest,
      latestISO: latest ? new Date(latest).toISOString() : null,
      totalSizeBytes: totalSize,
      totalSizeKB: Math.round(totalSize / 1024),
      totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
      storageDir: this.storageDir
    };
  }
}

module.exports = HistoryStorage;
