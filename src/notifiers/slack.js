const axios = require('axios');

class SlackNotifier {
  constructor(config) {
    this.webhookUrl = config.webhookUrl;
    this.username = config.username || 'ms-topology-bot';
    this.iconEmoji = config.iconEmoji || ':robot_face:';
    this.channel = config.channel;
  }

  async send(payload) {
    try {
      const message = {
        username: this.username,
        icon_emoji: this.iconEmoji,
        ...payload
      };

      if (this.channel) {
        message.channel = this.channel;
      }

      const response = await axios.post(this.webhookUrl, message, {
        timeout: 10000
      });

      return {
        success: true,
        status: response.status,
        statusText: response.statusText
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText
      };
    }
  }

  async sendSimple(text) {
    return this.send({ text });
  }

  async sendDriftReport(driftResult, analysis, options = {}) {
    const { severityThreshold = 'info' } = options;

    const severityScore = { normal: 0, info: 1, warning: 2, critical: 3 };
    if (severityScore[driftResult.severity] < severityScore[severityThreshold]) {
      return { success: true, skipped: true, reason: 'Severity below threshold' };
    }

    const blocks = this._buildDriftBlocks(driftResult, analysis);
    return this.send({ blocks, text: this._buildDriftText(driftResult) });
  }

  async sendFailureReport(simulationResult, analysis, options = {}) {
    const blocks = this._buildFailureBlocks(simulationResult, analysis);
    return this.send({ blocks, text: this._buildFailureText(simulationResult) });
  }

  async sendAnalysisReport(analysis, options = {}) {
    const { severityThreshold = 'warning' } = options;

    const overallStatus = analysis.health.summary.overallStatus;
    const statusScore = { healthy: 0, degraded: 1, unhealthy: 2 };
    if (statusScore[overallStatus] < severityThreshold) {
      return { success: true, skipped: true, reason: 'Status below threshold' };
    }

    const blocks = this._buildAnalysisBlocks(analysis);
    return this.send({ blocks, text: this._buildAnalysisText(analysis) });
  }

  _buildDriftText(drift) {
    return `[异常漂移] 严重程度: ${drift.severity.toUpperCase()}, 异常总数: ${drift.summary.totalAnomalies}`;
  }

  _buildDriftBlocks(drift, analysis) {
    const sevColor = drift.severity === 'critical' ? '#E53E3E' : drift.severity === 'warning' ? '#D69E2E' : '#38A169';
    const sevEmoji = drift.severity === 'critical' ? ':red_circle:' : drift.severity === 'warning' ? ':warning:' : ':information_source:';

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${sevEmoji} 异常漂移检测报告`,
          emoji: true
        }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*严重程度:* ${drift.severity.toUpperCase()}` },
          { type: 'mrkdwn', text: `*异常总数:* ${drift.summary.totalAnomalies}` },
          { type: 'mrkdwn', text: `*Critical:* ${drift.summary.criticalAnomalies}` },
          { type: 'mrkdwn', text: `*Warning:* ${drift.summary.warningAnomalies}` },
          { type: 'mrkdwn', text: `*Info:* ${drift.summary.infoAnomalies}` }
        ]
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `生成时间: ${new Date().toLocaleString()}` }
        ]
      },
      { type: 'divider' }
    ];

    if (drift.serviceAnomalies && drift.serviceAnomalies.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*🔧 服务级别异常:*'
        }
      });

      const topAnomalies = drift.serviceAnomalies.slice(0, 5);
      topAnomalies.forEach(item => {
        const color = item.maxSeverity === 'critical' ? ':red_circle:' : item.maxSeverity === 'warning' ? ':warning:' : ':small_blue_diamond:';
        const topIssues = item.anomalies.slice(0, 2).map(a => a.message).join('\n');
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${color} *${item.service}* (${item.anomalyCount}个异常)\n${topIssues}`
          }
        });
      });

      if (drift.serviceAnomalies.length > 5) {
        blocks.push({
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `...还有 ${drift.serviceAnomalies.length - 5} 个服务存在异常` }
          ]
        });
      }

      blocks.push({ type: 'divider' });
    }

    if (drift.trends && drift.trends.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*📈 趋势变化 (持续漂移):*'
        }
      });

      drift.trends.slice(0, 5).forEach(trend => {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:chart_with_upwards_trend: *${trend.service}*: ${trend.message}\n_斜率: ${trend.slope.toFixed(3)} | R²: ${trend.rSquared.toFixed(2)}_`
          }
        });
      });
    }

    blocks.push({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: '_此消息由 ms-topology CLI 自动发送_' }
      ]
    });

    return blocks;
  }

  _buildFailureText(simulation) {
    return `[故障模拟] ${simulation.failedService} 故障 - 严重程度: ${simulation.failureSeverity.severity.toUpperCase()}, 影响: ${simulation.impactSummary.totalAffectedServices}个服务`;
  }

  _buildFailureBlocks(simulation, analysis) {
    const sev = simulation.failureSeverity.severity;
    const sevColor = sev === 'critical' || sev === 'high' ? '#E53E3E' : sev === 'medium' ? '#D69E2E' : '#38A169';
    const sevEmoji = sev === 'critical' || sev === 'high' ? ':rotating_light:' : sev === 'medium' ? ':warning:' : ':information_source:';

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${sevEmoji} 故障模拟分析报告`,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*故障服务:* \`${simulation.failedService}\``
        }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*严重程度:* ${sev.toUpperCase()} (${simulation.failureSeverity.score}/100)` },
          { type: 'mrkdwn', text: `*影响服务:* ${simulation.impactSummary.totalAffectedServices}` },
          { type: 'mrkdwn', text: `*直接依赖:* ${simulation.impactSummary.directlyAffected}` },
          { type: 'mrkdwn', text: `*间接影响:* ${simulation.impactSummary.indirectlyAffected}` },
          { type: 'mrkdwn', text: `*流量占比:* ${simulation.impactSummary.trafficImpact.percentageOfTotalTraffic}%` }
        ]
      },
      { type: 'divider' }
    ];

    const ai = simulation.impactSummary.adjustedImpact;
    if (ai.overallReduction > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:zap: *容错机制降低影响:* 原始 ${simulation.impactSummary.totalAffectedServices} → 调整后 ${ai.adjustedAffectedCount} (降低 ${ai.overallReduction}%)`
        }
      });

      if (ai.protectedServices.length > 0) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:shield: *受保护的服务 (${ai.protectedServices.length}个):*\n${ai.protectedServices.slice(0, 3).map(s => `• ${s.service}: ${s.resilienceDesc}`).join('\n')}`
          }
        });
      }

      if (ai.vulnerableServices.length > 0) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:warning: *无保护的服务 (${ai.vulnerableServices.length}个):*\n${ai.vulnerableServices.slice(0, 3).map(s => `• ${s.service}`).join('\n')}`
          }
        });
      }

      blocks.push({ type: 'divider' });
    }

    if (simulation.recoveryRecommendations && simulation.recoveryRecommendations.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*:clipboard: 恢复建议:*'
        }
      });

      simulation.recoveryRecommendations.slice(0, 5).forEach(r => {
        const emoji = r.priority === 'critical' || r.priority === 'immediate' ? ':red_circle:' : r.priority === 'high' ? ':warning:' : ':small_blue_diamond:';
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${emoji} [${r.priority.toUpperCase()}] ${r.action}\n_${r.reason}_`
          }
        });
      });
    }

    blocks.push({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: '_此消息由 ms-topology CLI 自动发送_' }
      ]
    });

    return blocks;
  }

  _buildAnalysisText(analysis) {
    const summary = analysis.health.summary;
    return `[集群诊断] 健康评分: ${summary.overallScore}/100, 状态: ${summary.overallStatus}`;
  }

  _buildAnalysisBlocks(analysis) {
    const summary = analysis.health.summary;
    const statusColor = summary.overallStatus === 'healthy' ? '#38A169' : summary.overallStatus === 'degraded' ? '#D69E2E' : '#E53E3E';
    const statusEmoji = summary.overallStatus === 'healthy' ? ':white_check_mark:' : summary.overallStatus === 'degraded' ? ':warning:' : ':x:';

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${statusEmoji} 集群诊断报告`,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*整体健康评分:* \`${summary.overallScore}/100\`\n*整体状态:* \`${summary.overallStatus}\``
        }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*总服务数:* ${summary.total}` },
          { type: 'mrkdwn', text: `*健康:* ${summary.healthy}` },
          { type: 'mrkdwn', text: `*性能下降:* ${summary.degraded}` },
          { type: 'mrkdwn', text: `*异常:* ${summary.unhealthy}` }
        ]
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `生成时间: ${new Date().toLocaleString()}` }
        ]
      },
      { type: 'divider' }
    ];

    if (analysis.criticalPath && analysis.criticalPath.criticalPath) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*⚡ 关键路径 (${analysis.criticalPath.totalDuration}ms):*\n\`${analysis.criticalPath.criticalPath.join(' → ')}\``
        }
      });
    }

    if (analysis.performance && analysis.performance.bottlenecks && analysis.performance.bottlenecks.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🎯 性能瓶颈 (${analysis.performance.bottlenecks.length}个):*`
        }
      });

      analysis.performance.bottlenecks.slice(0, 3).forEach(b => {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:warning: ${b.edge} (负载: ${Math.round(b.load)})\n${b.issues.slice(0, 1).map(i => i.message).join('')}`
          }
        });
      });
    }

    if (analysis.health && analysis.health.warnings && analysis.health.warnings.length > 0) {
      blocks.push({ type: 'divider' });
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*⚠️ 警告信息 (${analysis.health.warnings.length}条):*`
        }
      });

      analysis.health.warnings.slice(0, 3).forEach(w => {
        const emoji = w.severity === 'critical' ? ':red_circle:' : w.severity === 'warning' ? ':warning:' : ':information_source:';
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${emoji} ${w.message}`
          }
        });
      });
    }

    blocks.push({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: '_此消息由 ms-topology CLI 自动发送_' }
      ]
    });

    return blocks;
  }

  async verify() {
    try {
      const result = await this.sendSimple(`:white_check_mark: ms-topology Slack 通知测试 - ${new Date().toLocaleString()}`);
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = SlackNotifier;
