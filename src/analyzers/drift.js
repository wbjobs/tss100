class DriftAnalyzer {
  constructor(historyStorage, options = {}) {
    this.history = historyStorage;
    this.thresholds = {
      latencySuddenSpike: 0.5,
      latencyGradualIncrease: 0.3,
      errorRateSuddenSpike: 0.02,
      errorRateGradualIncrease: 0.01,
      healthScoreDrop: 10,
      cpuIncrease: 20,
      memoryIncrease: 20,
      instanceCountDrop: 1,
      ...options.thresholds
    };
    this.minSnapshotsForTrend = options.minSnapshotsForTrend || 5;
    this.lookbackDays = options.lookbackDays || 7;
  }

  detect(currentSnapshot) {
    const result = {
      timestamp: Date.now(),
      timestampISO: new Date().toISOString(),
      summary: {
        totalAnomalies: 0,
        criticalAnomalies: 0,
        warningAnomalies: 0,
        infoAnomalies: 0
      },
      serviceAnomalies: [],
      edgeAnomalies: [],
      trends: [],
      comparison: null
    };

    const recentSnapshots = this._loadRecentSnapshots();
    if (recentSnapshots.length === 0) {
      return {
        ...result,
        hasAnomalies: false,
        info: '历史数据不足，无法进行漂移检测'
      };
    }

    const baselineSnapshot = recentSnapshots[0];
    const previousSnapshot = recentSnapshots[recentSnapshots.length - 1];

    result.comparison = {
      baselineTimestamp: baselineSnapshot.timestamp,
      baselineISO: baselineSnapshot.timestampISO,
      previousTimestamp: previousSnapshot.timestamp,
      previousISO: previousSnapshot.timestampISO,
      currentTimestamp: currentSnapshot.timestamp,
      currentISO: currentSnapshot.timestampISO,
      snapshotCount: recentSnapshots.length + 1
    };

    this._detectServiceAnomalies(currentSnapshot, baselineSnapshot, previousSnapshot, recentSnapshots, result);
    this._detectEdgeAnomalies(currentSnapshot, baselineSnapshot, previousSnapshot, recentSnapshots, result);
    this._detectTrends(currentSnapshot, recentSnapshots, result);
    this._detectSummaryChanges(currentSnapshot, baselineSnapshot, result);

    result.summary.totalAnomalies =
      result.serviceAnomalies.length + result.edgeAnomalies.length + result.trends.length;

    result.hasAnomalies = result.summary.totalAnomalies > 0;
    result.severity = this._calculateOverallSeverity(result);

    return result;
  }

  _loadRecentSnapshots() {
    const fromTime = Date.now() - this.lookbackDays * 24 * 60 * 60 * 1000;
    return this.history.loadSnapshotsInRange(fromTime, Date.now());
  }

  _detectServiceAnomalies(current, baseline, previous, history, result) {
    const currentServices = current.services;
    const baselineServices = baseline.services;
    const previousServices = previous.services;

    for (const [serviceName, currentMetrics] of Object.entries(currentServices)) {
      const baselineMetrics = baselineServices[serviceName];
      const previousMetrics = previousServices[serviceName];

      if (!baselineMetrics) continue;

      const anomalies = [];

      if (previousMetrics && currentMetrics.healthStatus !== previousMetrics.healthStatus) {
        if (currentMetrics.healthStatus === 'unhealthy') {
          anomalies.push({
            type: 'health_status_critical',
            metric: 'healthStatus',
            severity: 'critical',
            message: `服务状态从 ${previousMetrics.healthStatus} 恶化为 ${currentMetrics.healthStatus}`,
            from: previousMetrics.healthStatus,
            to: currentMetrics.healthStatus
          });
        } else if (currentMetrics.healthStatus === 'degraded' && previousMetrics.healthStatus === 'healthy') {
          anomalies.push({
            type: 'health_status_warning',
            metric: 'healthStatus',
            severity: 'warning',
            message: `服务状态从 ${previousMetrics.healthStatus} 变为 ${currentMetrics.healthStatus}`,
            from: previousMetrics.healthStatus,
            to: currentMetrics.healthStatus
          });
        } else if (currentMetrics.healthStatus === 'healthy' && previousMetrics.healthStatus !== 'healthy') {
          anomalies.push({
            type: 'health_status_improved',
            metric: 'healthStatus',
            severity: 'info',
            message: `服务状态从 ${previousMetrics.healthStatus} 恢复为 ${currentMetrics.healthStatus}`,
            from: previousMetrics.healthStatus,
            to: currentMetrics.healthStatus
          });
        }
      }

      const scoreDrop = baselineMetrics.score - currentMetrics.score;
      if (scoreDrop >= this.thresholds.healthScoreDrop) {
        anomalies.push({
          type: 'health_score_drop',
          metric: 'score',
          severity: scoreDrop >= this.thresholds.healthScoreDrop * 1.5 ? 'critical' : 'warning',
          message: `健康评分较基线下降 ${scoreDrop.toFixed(0)} 分 (${baselineMetrics.score} → ${currentMetrics.score})`,
          from: baselineMetrics.score,
          to: currentMetrics.score,
          change: -scoreDrop,
          changePercent: -((scoreDrop / baselineMetrics.score) * 100).toFixed(1)
        });
      } else if (currentMetrics.score - baselineMetrics.score >= this.thresholds.healthScoreDrop / 2) {
        anomalies.push({
          type: 'health_score_improved',
          metric: 'score',
          severity: 'info',
          message: `健康评分较基线提升 ${(currentMetrics.score - baselineMetrics.score).toFixed(0)} 分`,
          from: baselineMetrics.score,
          to: currentMetrics.score,
          change: currentMetrics.score - baselineMetrics.score
        });
      }

      if (currentMetrics.avgIncomingLatency > 0 && baselineMetrics.avgIncomingLatency > 0) {
        const latencyChange = (currentMetrics.avgIncomingLatency - baselineMetrics.avgIncomingLatency) / baselineMetrics.avgIncomingLatency;
        if (latencyChange >= this.thresholds.latencySuddenSpike) {
          anomalies.push({
            type: 'latency_spike',
            metric: 'avgIncomingLatency',
            severity: latencyChange >= this.thresholds.latencySuddenSpike * 2 ? 'critical' : 'warning',
            message: `入站延迟较基线突增 ${(latencyChange * 100).toFixed(0)}% (${baselineMetrics.avgIncomingLatency}ms → ${currentMetrics.avgIncomingLatency}ms)`,
            from: baselineMetrics.avgIncomingLatency,
            to: currentMetrics.avgIncomingLatency,
            change: currentMetrics.avgIncomingLatency - baselineMetrics.avgIncomingLatency,
            changePercent: (latencyChange * 100).toFixed(1)
          });
        }
      }

      if (currentMetrics.errorRate > 0) {
        const errorRateDiff = currentMetrics.errorRate - baselineMetrics.errorRate;
        if (errorRateDiff >= this.thresholds.errorRateSuddenSpike) {
          anomalies.push({
            type: 'error_rate_spike',
            metric: 'errorRate',
            severity: errorRateDiff >= this.thresholds.errorRateSuddenSpike * 2 ? 'critical' : 'warning',
            message: `错误率较基线突增 ${errorRateDiff.toFixed(2)} 个百分点 (${baselineMetrics.errorRate.toFixed(2)}% → ${currentMetrics.errorRate.toFixed(2)}%)`,
            from: baselineMetrics.errorRate,
            to: currentMetrics.errorRate,
            change: errorRateDiff,
            changePercent: baselineMetrics.errorRate > 0 ? ((errorRateDiff / baselineMetrics.errorRate) * 100).toFixed(1) : null
          });
        }
      }

      const cpuIncrease = currentMetrics.cpuUsage - baselineMetrics.cpuUsage;
      if (cpuIncrease >= this.thresholds.cpuIncrease) {
        anomalies.push({
          type: 'cpu_increase',
          metric: 'cpuUsage',
          severity: cpuIncrease >= this.thresholds.cpuIncrease * 1.5 ? 'critical' : 'warning',
          message: `CPU使用率较基线上升 ${cpuIncrease.toFixed(0)} 个百分点 (${baselineMetrics.cpuUsage}% → ${currentMetrics.cpuUsage}%)`,
          from: baselineMetrics.cpuUsage,
          to: currentMetrics.cpuUsage,
          change: cpuIncrease
        });
      }

      const memoryIncrease = currentMetrics.memoryUsage - baselineMetrics.memoryUsage;
      if (memoryIncrease >= this.thresholds.memoryIncrease) {
        anomalies.push({
          type: 'memory_increase',
          metric: 'memoryUsage',
          severity: memoryIncrease >= this.thresholds.memoryIncrease * 1.5 ? 'critical' : 'warning',
          message: `内存使用率较基线上升 ${memoryIncrease.toFixed(0)} 个百分点 (${baselineMetrics.memoryUsage}% → ${currentMetrics.memoryUsage}%)`,
          from: baselineMetrics.memoryUsage,
          to: currentMetrics.memoryUsage,
          change: memoryIncrease
        });
      }

      const instanceDrop = baselineMetrics.instanceCount - currentMetrics.instanceCount;
      if (instanceDrop >= this.thresholds.instanceCountDrop && currentMetrics.instanceCount < baselineMetrics.instanceCount) {
        anomalies.push({
          type: 'instance_count_drop',
          metric: 'instanceCount',
          severity: currentMetrics.instanceCount === 1 ? 'critical' : 'warning',
          message: `实例数量减少 ${instanceDrop} 个 (${baselineMetrics.instanceCount} → ${currentMetrics.instanceCount})`,
          from: baselineMetrics.instanceCount,
          to: currentMetrics.instanceCount,
          change: -instanceDrop
        });
      }

      if (anomalies.length > 0) {
        const maxSeverity = Math.max(...anomalies.map(a => this._severityToScore(a.severity)));
        result.serviceAnomalies.push({
          service: serviceName,
          anomalies,
          maxSeverity: this._scoreToSeverity(maxSeverity),
          anomalyCount: anomalies.length
        });
        anomalies.forEach(a => result.summary[`${a.severity}Anomalies`]++);
      }
    }

    result.serviceAnomalies.sort((a, b) => this._severityToScore(b.maxSeverity) - this._severityToScore(a.maxSeverity));
  }

  _detectEdgeAnomalies(current, baseline, previous, history, result) {
    const currentEdges = current.edges;
    const baselineEdges = baseline.edges;

    for (const [edgeKey, currentMetrics] of Object.entries(currentEdges)) {
      const baselineMetrics = baselineEdges[edgeKey];
      if (!baselineMetrics) continue;

      const anomalies = [];

      if (currentMetrics.avgLatency > 0 && baselineMetrics.avgLatency > 0) {
        const latencyChange = (currentMetrics.avgLatency - baselineMetrics.avgLatency) / baselineMetrics.avgLatency;
        if (latencyChange >= this.thresholds.latencySuddenSpike) {
          anomalies.push({
            type: 'edge_latency_spike',
            metric: 'avgLatency',
            severity: latencyChange >= this.thresholds.latencySuddenSpike * 2 ? 'critical' : 'warning',
            message: `调用延迟较基线突增 ${(latencyChange * 100).toFixed(0)}% (${baselineMetrics.avgLatency}ms → ${currentMetrics.avgLatency}ms)`,
            from: baselineMetrics.avgLatency,
            to: currentMetrics.avgLatency,
            change: currentMetrics.avgLatency - baselineMetrics.avgLatency,
            changePercent: (latencyChange * 100).toFixed(1)
          });
        }
      }

      if (currentMetrics.errorRate > 0) {
        const errorRateDiff = currentMetrics.errorRate - baselineMetrics.errorRate;
        if (errorRateDiff >= this.thresholds.errorRateSuddenSpike) {
          anomalies.push({
            type: 'edge_error_rate_spike',
            metric: 'errorRate',
            severity: errorRateDiff >= this.thresholds.errorRateSuddenSpike * 2 ? 'critical' : 'warning',
            message: `调用错误率较基线突增 ${errorRateDiff.toFixed(2)} 个百分点 (${baselineMetrics.errorRate.toFixed(2)}% → ${currentMetrics.errorRate.toFixed(2)}%)`,
            from: baselineMetrics.errorRate,
            to: currentMetrics.errorRate,
            change: errorRateDiff
          });
        }
      }

      if (baselineMetrics.circuitBreakerState === 'closed' && currentMetrics.circuitBreakerState === 'open') {
        anomalies.push({
          type: 'circuit_breaker_opened',
          metric: 'circuitBreakerState',
          severity: 'critical',
          message: '熔断器已打开，流量被阻断',
          from: 'closed',
          to: 'open'
        });
      } else if (baselineMetrics.circuitBreakerState === 'open' && currentMetrics.circuitBreakerState === 'half-open') {
        anomalies.push({
          type: 'circuit_breaker_recovering',
          metric: 'circuitBreakerState',
          severity: 'info',
          message: '熔断器半开，正在探测恢复',
          from: 'open',
          to: 'half-open'
        });
      } else if (baselineMetrics.circuitBreakerState === 'open' && currentMetrics.circuitBreakerState === 'closed') {
        anomalies.push({
          type: 'circuit_breaker_recovered',
          metric: 'circuitBreakerState',
          severity: 'info',
          message: '熔断器已恢复关闭',
          from: 'open',
          to: 'closed'
        });
      }

      if (anomalies.length > 0) {
        const maxSeverity = Math.max(...anomalies.map(a => this._severityToScore(a.severity)));
        result.edgeAnomalies.push({
          edge: edgeKey,
          from: currentMetrics.from,
          to: currentMetrics.to,
          anomalies,
          maxSeverity: this._scoreToSeverity(maxSeverity),
          anomalyCount: anomalies.length
        });
        anomalies.forEach(a => result.summary[`${a.severity}Anomalies`]++);
      }
    }

    result.edgeAnomalies.sort((a, b) => this._severityToScore(b.maxSeverity) - this._severityToScore(a.maxSeverity));
  }

  _detectTrends(current, history, result) {
    if (history.length < this.minSnapshotsForTrend) return;

    const allSnapshots = [...history, current];
    const currentServices = current.services;

    for (const [serviceName, currentMetrics] of Object.entries(currentServices)) {
      const series = this._collectServiceMetricSeries(serviceName, allSnapshots);
      if (series.length < this.minSnapshotsForTrend) continue;

      const latencyTrend = this._calculateTrend(series, 'avgIncomingLatency');
      const errorTrend = this._calculateTrend(series, 'errorRate');
      const cpuTrend = this._calculateTrend(series, 'cpuUsage');
      const memoryTrend = this._calculateTrend(series, 'memoryUsage');
      const scoreTrend = this._calculateTrend(series, 'score');

      if (latencyTrend && latencyTrend.direction === 'up' && latencyTrend.slopePercent >= this.thresholds.latencyGradualIncrease * 100) {
        result.trends.push({
          type: 'latency_gradual_increase',
          service: serviceName,
          metric: 'avgIncomingLatency',
          severity: latencyTrend.slopePercent >= this.thresholds.latencyGradualIncrease * 200 ? 'warning' : 'info',
          message: `入站延迟持续上升，过去 ${series.length} 次采样平均每次增长 ${latencyTrend.slopePercent.toFixed(1)}%`,
          slope: latencyTrend.slope,
          slopePercent: latencyTrend.slopePercent,
          rSquared: latencyTrend.rSquared,
          dataPoints: series.map(s => ({ timestamp: s.timestamp, value: s.avgIncomingLatency }))
        });
        result.summary[`${latencyTrend.slopePercent >= this.thresholds.latencyGradualIncrease * 200 ? 'warning' : 'info'}Anomalies`]++;
      }

      if (errorTrend && errorTrend.direction === 'up' && errorTrend.slope >= this.thresholds.errorRateGradualIncrease) {
        result.trends.push({
          type: 'error_rate_gradual_increase',
          service: serviceName,
          metric: 'errorRate',
          severity: errorTrend.slope >= this.thresholds.errorRateGradualIncrease * 2 ? 'warning' : 'info',
          message: `错误率持续上升，过去 ${series.length} 次采样平均每次增长 ${errorTrend.slope.toFixed(3)} 个百分点`,
          slope: errorTrend.slope,
          slopePercent: errorTrend.slopePercent,
          rSquared: errorTrend.rSquared,
          dataPoints: series.map(s => ({ timestamp: s.timestamp, value: s.errorRate }))
        });
        result.summary[`${errorTrend.slope >= this.thresholds.errorRateGradualIncrease * 2 ? 'warning' : 'info'}Anomalies`]++;
      }

      if (cpuTrend && cpuTrend.direction === 'up' && cpuTrend.slope >= this.thresholds.cpuIncrease / 5) {
        result.trends.push({
          type: 'cpu_gradual_increase',
          service: serviceName,
          metric: 'cpuUsage',
          severity: 'info',
          message: `CPU使用率持续上升，过去 ${series.length} 次采样平均每次增长 ${cpuTrend.slope.toFixed(1)} 个百分点`,
          slope: cpuTrend.slope,
          slopePercent: cpuTrend.slopePercent,
          rSquared: cpuTrend.rSquared,
          dataPoints: series.map(s => ({ timestamp: s.timestamp, value: s.cpuUsage }))
        });
        result.summary.infoAnomalies++;
      }

      if (scoreTrend && scoreTrend.direction === 'down' && Math.abs(scoreTrend.slope) >= this.thresholds.healthScoreDrop / 5) {
        result.trends.push({
          type: 'health_score_gradual_decline',
          service: serviceName,
          metric: 'score',
          severity: Math.abs(scoreTrend.slope) >= this.thresholds.healthScoreDrop / 2.5 ? 'warning' : 'info',
          message: `健康评分持续下降，过去 ${series.length} 次采样平均每次下降 ${Math.abs(scoreTrend.slope).toFixed(1)} 分`,
          slope: scoreTrend.slope,
          slopePercent: scoreTrend.slopePercent,
          rSquared: scoreTrend.rSquared,
          direction: 'down',
          dataPoints: series.map(s => ({ timestamp: s.timestamp, value: s.score }))
        });
        result.summary[`${Math.abs(scoreTrend.slope) >= this.thresholds.healthScoreDrop / 2.5 ? 'warning' : 'info'}Anomalies`]++;
      }
    }

    result.trends.sort((a, b) => this._severityToScore(b.severity) - this._severityToScore(a.severity));
  }

  _collectServiceMetricSeries(serviceName, snapshots) {
    return snapshots
      .map(s => ({
        timestamp: s.timestamp,
        ...(s.services[serviceName] || {})
      }))
      .filter(s => s.score !== undefined);
  }

  _calculateTrend(series, metric) {
    const values = series.map(s => s[metric]).filter(v => v !== undefined && v !== null && !isNaN(v));
    if (values.length < this.minSnapshotsForTrend) return null;

    const n = values.length;
    const indices = Array.from({ length: n }, (_, i) => i);
    const xMean = indices.reduce((a, b) => a + b, 0) / n;
    const yMean = values.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denominator = 0;
    let ssTotal = 0;
    let ssResidual = 0;

    for (let i = 0; i < n; i++) {
      const xDiff = indices[i] - xMean;
      const yDiff = values[i] - yMean;
      numerator += xDiff * yDiff;
      denominator += xDiff * xDiff;
      ssTotal += yDiff * yDiff;
    }

    if (denominator === 0) return null;

    const slope = numerator / denominator;
    const intercept = yMean - slope * xMean;

    for (let i = 0; i < n; i++) {
      const predicted = slope * indices[i] + intercept;
      ssResidual += Math.pow(values[i] - predicted, 2);
    }

    const rSquared = ssTotal > 0 ? 1 - (ssResidual / ssTotal) : 1;
    const firstValue = values[0];
    const slopePercent = firstValue !== 0 ? (slope / firstValue) * 100 : 0;

    return {
      slope,
      slopePercent,
      intercept,
      rSquared,
      direction: slope > 0.001 ? 'up' : slope < -0.001 ? 'down' : 'stable',
      dataPoints: n,
      values
    };
  }

  _detectSummaryChanges(current, baseline, result) {
    const cur = current.summary;
    const base = baseline.summary;

    const anomalies = [];

    if (cur.overallScore < base.overallScore - this.thresholds.healthScoreDrop) {
      anomalies.push({
        type: 'overall_score_drop',
        severity: cur.overallScore < 60 ? 'critical' : 'warning',
        message: `集群整体健康评分较基线下降 ${(base.overallScore - cur.overallScore).toFixed(0)} 分 (${base.overallScore} → ${cur.overallScore})`,
        from: base.overallScore,
        to: cur.overallScore
      });
    }

    if (cur.unhealthyCount > base.unhealthyCount) {
      anomalies.push({
        type: 'unhealthy_count_increase',
        severity: cur.unhealthyCount >= 3 ? 'critical' : 'warning',
        message: `异常服务数量较基线增加 ${cur.unhealthyCount - base.unhealthyCount} 个 (${base.unhealthyCount} → ${cur.unhealthyCount})`,
        from: base.unhealthyCount,
        to: cur.unhealthyCount
      });
    }

    if (cur.slowEdgeCount > base.slowEdgeCount * 1.5) {
      anomalies.push({
        type: 'slow_edge_increase',
        severity: 'warning',
        message: `慢调用数量较基线显著增加 (${base.slowEdgeCount} → ${cur.slowEdgeCount})`,
        from: base.slowEdgeCount,
        to: cur.slowEdgeCount
      });
    }

    if (cur.highErrorEdgeCount > base.highErrorEdgeCount * 1.5) {
      anomalies.push({
        type: 'high_error_edge_increase',
        severity: cur.highErrorEdgeCount >= 3 ? 'critical' : 'warning',
        message: `高错误调用数量较基线显著增加 (${base.highErrorEdgeCount} → ${cur.highErrorEdgeCount})`,
        from: base.highErrorEdgeCount,
        to: cur.highErrorEdgeCount
      });
    }

    if (anomalies.length > 0) {
      result.summaryAnomalies = anomalies;
      anomalies.forEach(a => result.summary[`${a.severity}Anomalies`]++);
      result.summary.totalAnomalies += anomalies.length;
    }
  }

  _severityToScore(severity) {
    const scores = { critical: 3, warning: 2, info: 1 };
    return scores[severity] || 0;
  }

  _scoreToSeverity(score) {
    if (score >= 3) return 'critical';
    if (score >= 2) return 'warning';
    if (score >= 1) return 'info';
    return 'none';
  }

  _calculateOverallSeverity(result) {
    if (result.summary.criticalAnomalies > 0) return 'critical';
    if (result.summary.warningAnomalies > 0) return 'warning';
    if (result.summary.infoAnomalies > 0) return 'info';
    return 'normal';
  }

  formatDriftReport(driftResult, format = 'text') {
    if (format === 'html') {
      return this._formatHtmlReport(driftResult);
    }
    return this._formatTextReport(driftResult);
  }

  _formatTextReport(drift) {
    const lines = [];
    const chalk = require('chalk');

    lines.push('');
    lines.push(chalk.bold.white('═'.repeat(70)));
    lines.push(chalk.bold.white('  📈 异常漂移检测报告'));
    lines.push(chalk.bold.white('═'.repeat(70)));
    lines.push('');

    if (!drift.hasAnomalies) {
      lines.push(chalk.green('  ✅ 未检测到异常漂移，集群状态稳定'));
      lines.push(`  基线时间: ${drift.comparison?.baselineISO || 'N/A'}`);
      lines.push(`  当前时间: ${drift.timestampISO}`);
      lines.push('');
      return lines.join('\n');
    }

    const sevColor = drift.severity === 'critical' ? chalk.red.bold :
      drift.severity === 'warning' ? chalk.yellow.bold : chalk.blue.bold;
    lines.push(`  整体严重程度: ${sevColor(drift.severity.toUpperCase())}`);
    lines.push(`  异常总数: ${chalk.red(drift.summary.totalAnomalies)}`);
    lines.push(`    - Critical: ${chalk.red(drift.summary.criticalAnomalies)}`);
    lines.push(`    - Warning: ${chalk.yellow(drift.summary.warningAnomalies)}`);
    lines.push(`    - Info: ${chalk.blue(drift.summary.infoAnomalies)}`);
    lines.push('');
    lines.push(`  基线快照: ${drift.comparison?.baselineISO || 'N/A'}`);
    lines.push(`  当前快照: ${drift.timestampISO}`);
    lines.push(`  历史快照数: ${drift.comparison?.snapshotCount || 0}`);
    lines.push('');

    if (drift.summaryAnomalies && drift.summaryAnomalies.length > 0) {
      lines.push(chalk.bold.white('【集群整体异常】'));
      drift.summaryAnomalies.forEach(a => {
        const color = a.severity === 'critical' ? chalk.red : a.severity === 'warning' ? chalk.yellow : chalk.blue;
        lines.push(`  ${color('●')} ${a.message}`);
      });
      lines.push('');
    }

    if (drift.serviceAnomalies.length > 0) {
      lines.push(chalk.bold.white('【服务级别异常】'));
      drift.serviceAnomalies.slice(0, 10).forEach(item => {
        const sevColor = item.maxSeverity === 'critical' ? chalk.red : item.maxSeverity === 'warning' ? chalk.yellow : chalk.blue;
        lines.push(`\n  ${sevColor('▲')} ${chalk.bold(item.service)} (${item.anomalyCount}个异常)`);
        item.anomalies.forEach(a => {
          const aColor = a.severity === 'critical' ? chalk.red : a.severity === 'warning' ? chalk.yellow : chalk.blue;
          lines.push(`    ${aColor('-')} ${a.message}`);
        });
      });
      if (drift.serviceAnomalies.length > 10) {
        lines.push(`\n  ... 还有 ${drift.serviceAnomalies.length - 10} 个服务存在异常`);
      }
      lines.push('');
    }

    if (drift.edgeAnomalies.length > 0) {
      lines.push(chalk.bold.white('【调用边级别异常】'));
      drift.edgeAnomalies.slice(0, 10).forEach(item => {
        const sevColor = item.maxSeverity === 'critical' ? chalk.red : item.maxSeverity === 'warning' ? chalk.yellow : chalk.blue;
        lines.push(`\n  ${sevColor('▲')} ${chalk.bold(item.edge)} (${item.anomalyCount}个异常)`);
        item.anomalies.forEach(a => {
          const aColor = a.severity === 'critical' ? chalk.red : a.severity === 'warning' ? chalk.yellow : chalk.blue;
          lines.push(`    ${aColor('-')} ${a.message}`);
        });
      });
      if (drift.edgeAnomalies.length > 10) {
        lines.push(`\n  ... 还有 ${drift.edgeAnomalies.length - 10} 条调用边存在异常`);
      }
      lines.push('');
    }

    if (drift.trends.length > 0) {
      lines.push(chalk.bold.white('【趋势变化 (持续漂移)】'));
      drift.trends.slice(0, 10).forEach(trend => {
        const sevColor = trend.severity === 'warning' ? chalk.yellow : chalk.blue;
        lines.push(`  ${sevColor('↗')} ${chalk.bold(trend.service)}: ${trend.message}`);
        lines.push(`    斜率: ${trend.slope.toFixed(3)} (${trend.slopePercent > 0 ? '+' : ''}${trend.slopePercent.toFixed(1)}%) | R²: ${trend.rSquared.toFixed(2)}`);
      });
      if (drift.trends.length > 10) {
        lines.push(`\n  ... 还有 ${drift.trends.length - 10} 个趋势变化`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  _formatHtmlReport(drift) {
    let content = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>异常漂移检测报告</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; color: #333; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 12px; margin-bottom: 20px; }
    .severity { display: inline-block; padding: 4px 12px; border-radius: 20px; font-weight: bold; }
    .severity.critical { background: #fed7d7; color: #742a2a; }
    .severity.warning { background: #fefcbf; color: #744210; }
    .severity.info { background: #bee3f8; color: #2a4365; }
    .section { background: white; border-radius: 12px; padding: 25px; margin-bottom: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
    .section h2 { margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; }
    .anomaly-item { padding: 15px; background: #fff5f5; border-left: 4px solid #e53e3e; border-radius: 4px; margin-bottom: 10px; }
    .anomaly-item.warning { background: #fffaf0; border-left-color: #d69e2e; }
    .anomaly-item.info { background: #ebf8ff; border-left-color: #4299e1; }
    .metric { font-family: monospace; background: #f7fafc; padding: 2px 6px; border-radius: 4px; }
    .trend { padding: 15px; background: #f0fff4; border-left: 4px solid #38a169; border-radius: 4px; margin-bottom: 10px; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin: 20px 0; }
    .summary-card { text-align: center; padding: 20px; background: #f7fafc; border-radius: 8px; }
    .summary-card .value { font-size: 28px; font-weight: bold; }
    .summary-card.critical .value { color: #e53e3e; }
    .summary-card.warning .value { color: #d69e2e; }
    .summary-card.info .value { color: #4299e1; }
  </style>
</head>
<body>
  <div class="header">
    <h1>📈 异常漂移检测报告</h1>
    <p>生成时间: ${new Date().toLocaleString()}</p>
    <p style="margin-top: 15px;">整体严重程度: <span class="severity ${drift.severity}">${drift.severity.toUpperCase()}</span></p>
  </div>

  <div class="summary-grid">
    <div class="summary-card"><div class="label">异常总数</div><div class="value critical">${drift.summary.totalAnomalies}</div></div>
    <div class="summary-card"><div class="label">Critical</div><div class="value critical">${drift.summary.criticalAnomalies}</div></div>
    <div class="summary-card"><div class="label">Warning</div><div class="value warning">${drift.summary.warningAnomalies}</div></div>
    <div class="summary-card"><div class="label">Info</div><div class="value info">${drift.summary.infoAnomalies}</div></div>
  </div>

  <div class="section">
    <h2>📊 对比信息</h2>
    <p>基线快照: ${drift.comparison?.baselineISO || 'N/A'}</p>
    <p>当前快照: ${drift.timestampISO}</p>
    <p>历史快照数: ${drift.comparison?.snapshotCount || 0}</p>
  </div>`;

    if (drift.summaryAnomalies && drift.summaryAnomalies.length > 0) {
      content += `<div class="section"><h2>⚠️ 集群整体异常</h2>`;
      drift.summaryAnomalies.forEach(a => {
        content += `<div class="anomaly-item ${a.severity}">${a.message}</div>`;
      });
      content += `</div>`;
    }

    if (drift.serviceAnomalies.length > 0) {
      content += `<div class="section"><h2>🔧 服务级别异常</h2>`;
      drift.serviceAnomalies.slice(0, 10).forEach(item => {
        content += `<div class="anomaly-item ${item.maxSeverity}"><strong>${item.service}</strong> (${item.anomalyCount}个异常)`;
        item.anomalies.forEach(a => {
          content += `<div style="margin-top: 8px; color: #666;">• ${a.message} <span class="metric">${a.metric}</span></div>`;
        });
        content += `</div>`;
      });
      content += `</div>`;
    }

    if (drift.edgeAnomalies.length > 0) {
      content += `<div class="section"><h2>🔗 调用边级别异常</h2>`;
      drift.edgeAnomalies.slice(0, 10).forEach(item => {
        content += `<div class="anomaly-item ${item.maxSeverity}"><strong>${item.edge}</strong> (${item.anomalyCount}个异常)`;
        item.anomalies.forEach(a => {
          content += `<div style="margin-top: 8px; color: #666;">• ${a.message}</div>`;
        });
        content += `</div>`;
      });
      content += `</div>`;
    }

    if (drift.trends.length > 0) {
      content += `<div class="section"><h2>📈 趋势变化</h2>`;
      drift.trends.slice(0, 10).forEach(trend => {
        content += `<div class="trend"><strong>${trend.service}</strong>: ${trend.message}<br>`;
        content += `<span style="font-size: 12px; color: #666;">斜率: ${trend.slope.toFixed(3)} | R²: ${trend.rSquared.toFixed(2)}</span></div>`;
      });
      content += `</div>`;
    }

    if (!drift.hasAnomalies) {
      content += `<div class="section"><h2>✅ 状态正常</h2><p>未检测到异常漂移，集群状态稳定。</p></div>`;
    }

    content += `</body></html>`;
    return content;
  }
}

module.exports = DriftAnalyzer;
