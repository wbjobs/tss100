const nodemailer = require('nodemailer');

class EmailNotifier {
  constructor(config) {
    this.config = config;
    this.transporter = this._createTransporter();
  }

  _createTransporter() {
    const options = {
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure !== false,
      auth: {
        user: this.config.username,
        pass: this.config.password
      }
    };

    if (this.config.service) {
      delete options.host;
      delete options.port;
      delete options.secure;
      options.service = this.config.service;
    }

    return nodemailer.createTransport(options);
  }

  async send(options) {
    const { to, subject, text, html, attachments, from, replyTo } = options;

    const mailOptions = {
      from: from || this.config.from || this.config.username,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text,
      html,
      replyTo: replyTo || this.config.replyTo
    };

    if (attachments && attachments.length > 0) {
      mailOptions.attachments = attachments.map(a => ({
        filename: a.filename,
        content: a.content,
        path: a.path,
        contentType: a.contentType
      }));
    }

    try {
      const info = await this.transporter.sendMail(mailOptions);
      return {
        success: true,
        messageId: info.messageId,
        response: info.response,
        info
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        errorStack: error.stack
      };
    }
  }

  async sendDriftReport(driftResult, analysis, options) {
    const { to, severityThreshold = 'info', includeAttachments = true } = options;

    const severityScore = { normal: 0, info: 1, warning: 2, critical: 3 };
    if (severityScore[driftResult.severity] < severityScore[severityThreshold]) {
      return { success: true, skipped: true, reason: 'Severity below threshold' };
    }

    const subject = this._buildDriftSubject(driftResult);
    const text = this._buildDriftText(driftResult, analysis);
    const html = this._buildDriftHtml(driftResult, analysis);

    const attachments = [];
    if (includeAttachments) {
      const htmlReport = this._buildFullHtmlReport(driftResult, analysis);
      attachments.push({
        filename: `drift-report-${new Date().toISOString().replace(/[:.]/g, '-')}.html`,
        content: htmlReport,
        contentType: 'text/html'
      });
    }

    return this.send({
      to,
      subject,
      text,
      html,
      attachments
    });
  }

  async sendFailureReport(simulationResult, analysis, options) {
    const { to } = options;

    const subject = `🚨 [故障模拟] ${simulationResult.failedService} 故障影响报告`;
    const text = this._buildFailureText(simulationResult, analysis);
    const html = this._buildFailureHtml(simulationResult, analysis);

    return this.send({ to, subject, text, html });
  }

  async sendAnalysisReport(analysis, options) {
    const { to, severityThreshold = 'warning' } = options;

    const overallStatus = analysis.health.summary.overallStatus;
    const statusScore = { healthy: 0, degraded: 1, unhealthy: 2 };
    if (statusScore[overallStatus] < severityThreshold) {
      return { success: true, skipped: true, reason: 'Status below threshold' };
    }

    const subject = this._buildAnalysisSubject(analysis);
    const text = this._buildAnalysisText(analysis);
    const html = this._buildAnalysisHtml(analysis);

    return this.send({ to, subject, text, html });
  }

  _buildDriftSubject(drift) {
    const severityEmoji = drift.severity === 'critical' ? '🔴' : drift.severity === 'warning' ? '🟡' : '🟢';
    return `${severityEmoji} [异常漂移] ${drift.summary.totalAnomalies}个异常 - ${new Date().toLocaleString()}`;
  }

  _buildDriftText(drift, analysis) {
    let text = `异常漂移检测报告\n`;
    text += `================================\n\n`;
    text += `生成时间: ${new Date().toLocaleString()}\n`;
    text += `整体严重程度: ${drift.severity.toUpperCase()}\n`;
    text += `异常总数: ${drift.summary.totalAnomalies}\n`;
    text += `  - Critical: ${drift.summary.criticalAnomalies}\n`;
    text += `  - Warning: ${drift.summary.warningAnomalies}\n`;
    text += `  - Info: ${drift.summary.infoAnomalies}\n\n`;

    if (drift.serviceAnomalies.length > 0) {
      text += `服务级别异常 (${drift.serviceAnomalies.length}个服务):\n`;
      drift.serviceAnomalies.slice(0, 5).forEach(item => {
        text += `\n  [${item.maxSeverity.toUpperCase()}] ${item.service}:${item.anomalyCount}个异常:\n`;
        item.anomalies.slice(0, 3).forEach(a => {
          text += `    - ${a.message}\n`;
        });
      });
      text += '\n';
    }

    if (drift.trends.length > 0) {
      text += `趋势变化 (${drift.trends.length}个):\n`;
      drift.trends.slice(0, 5).forEach(trend => {
        text += `  - ${trend.service}: ${trend.message}\n`;
      });
    }

    text += `\n--\n由 ms-topology CLI 自动发送`;
    return text;
  }

  _buildDriftHtml(drift, analysis) {
    const sevColor = drift.severity === 'critical' ? '#e53e3e' : drift.severity === 'warning' ? '#d69e2e' : '#38a169';

    return `
<div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 12px;">
    <h1 style="margin: 0; font-size: 24px;">📈 异常漂移检测报告</h1>
    <p style="margin: 10px 0 0 0;">生成时间: ${new Date().toLocaleString()}</p>
    <p style="margin: 15px 0 0 0; font-size: 16px;">
      整体严重程度: <strong style="background: rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 20px;">${drift.severity.toUpperCase()}</strong>
    </p>
  </div>

  <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin: 20px 0;">
    <div style="background: #f7fafc; padding: 20px; border-radius: 8px; text-align: center;">
      <div style="font-size: 13px; color: #718096; margin-bottom: 8px;">异常总数</div>
      <div style="font-size: 28px; font-weight: bold; color: ${sevColor};">${drift.summary.totalAnomalies}</div>
    </div>
    <div style="background: #fff5f5; padding: 20px; border-radius: 8px; text-align: center;">
      <div style="font-size: 13px; color: #718096; margin-bottom: 8px;">Critical</div>
      <div style="font-size: 28px; font-weight: bold; color: #e53e3e;">${drift.summary.criticalAnomalies}</div>
    </div>
    <div style="background: #fffaf0; padding: 20px; border-radius: 8px; text-align: center;">
      <div style="font-size: 13px; color: #718096; margin-bottom: 8px;">Warning</div>
      <div style="font-size: 28px; font-weight: bold; color: #d69e2e;">${drift.summary.warningAnomalies}</div>
    </div>
    <div style="background: #ebf8ff; padding: 20px; border-radius: 8px; text-align: center;">
      <div style="font-size: 13px; color: #718096; margin-bottom: 8px;">Info</div>
      <div style="font-size: 28px; font-weight: bold; color: #4299e1;">${drift.summary.infoAnomalies}</div>
    </div>
  </div>

  ${drift.serviceAnomalies.length > 0 ? `
  <div style="background: white; border-radius: 12px; padding: 25px; margin-bottom: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
    <h2 style="margin: 0 0 20px 0; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; color: #1a202c;">🔧 服务级别异常</h2>
    ${drift.serviceAnomalies.slice(0, 10).map(item => {
      const bgColor = item.maxSeverity === 'critical' ? '#fff5f5' : item.maxSeverity === 'warning' ? '#fffaf0' : '#ebf8ff';
      const borderColor = item.maxSeverity === 'critical' ? '#e53e3e' : item.maxSeverity === 'warning' ? '#d69e2e' : '#4299e1';
      return `
      <div style="padding: 15px; background: ${bgColor}; border-left: 4px solid ${borderColor}; border-radius: 4px; margin-bottom: 10px;">
        <strong style="font-size: 16px;">${item.service}</strong> <span style="color: #718096; font-size: 14px;">(${item.anomalyCount}个异常)</span>
        ${item.anomalies.slice(0, 3).map(a => `<div style="margin-top: 8px; color: #4a5568; font-size: 14px;">• ${a.message}</div>`).join('')}
      </div>
    `;
    }).join('')}
  </div>` : ''}

  ${drift.trends.length > 0 ? `
  <div style="background: white; border-radius: 12px; padding: 25px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
    <h2 style="margin: 0 0 20px 0; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; color: #1a202c;">📈 趋势变化</h2>
    ${drift.trends.slice(0, 5).map(trend => `
      <div style="padding: 15px; background: #f0fff4; border-left: 4px solid #38a169; border-radius: 4px; margin-bottom: 10px;">
        <strong>${trend.service}</strong>: ${trend.message}<br>
        <span style="font-size: 12px; color: #718096;">斜率: ${trend.slope.toFixed(3)} | R²: ${trend.rSquared.toFixed(2)}</span>
      </div>
    `).join('')}
  </div>` : ''}

  <div style="margin-top: 20px; padding: 15px; background: #f7fafc; border-radius: 8px; text-align: center; color: #718096; font-size: 12px;">
    此邮件由 ms-topology CLI 自动发送 • ${new Date().toLocaleString()}
  </div>
</div>`;
  }

  _buildFullHtmlReport(drift, analysis) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>异常漂移报告</title></head><body>${this._buildDriftHtml(drift, analysis)}</body></html>`;
  }

  _buildFailureText(simulation, analysis) {
    let text = `故障模拟分析报告\n`;
    text += `================================\n\n`;
    text += `故障服务: ${simulation.failedService}\n`;
    text += `严重程度: ${simulation.failureSeverity.severity.toUpperCase()}\n`;
    text += `影响服务数: ${simulation.impactSummary.totalAffectedServices}\n\n`;
    text += `直接依赖: ${simulation.impactSummary.directlyAffected}\n`;
    text += `间接影响: ${simulation.impactSummary.indirectlyAffected}\n\n`;
    text += `恢复建议:\n`;
    simulation.recoveryRecommendations.slice(0, 5).forEach(r => {
      text += `  [${r.priority.toUpperCase()}] ${r.action}\n`;
    });
    text += `\n--\n由 ms-topology CLI 自动发送`;
    return text;
  }

  _buildFailureHtml(simulation, analysis) {
    const sev = simulation.failureSeverity.severity;
    const sevColor = sev === 'critical' ? '#e53e3e' : sev === 'high' ? '#d69e2e' : sev === 'medium' ? '#d69e2e' : '#38a169';

    return `
<div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
  <div style="background: linear-gradient(135deg, #f56565 0%, #c53030 100%); color: white; padding: 30px; border-radius: 12px;">
    <h1 style="margin: 0; font-size: 24px;">🚨 故障模拟分析报告</h1>
    <p style="margin: 10px 0 0 0;">故障服务: <strong>${simulation.failedService}</strong></p>
  </div>
  <div style="background: white; border-radius: 12px; padding: 25px; margin-top: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
    <h2 style="margin: 0 0 15px 0; color: #1a202c;">影响汇总</h2>
    <p><strong>严重程度:</strong> <span style="color: ${sevColor}; font-weight: bold;">${sev.toUpperCase()}</span> (${simulation.failureSeverity.score}/100)</p>
    <p><strong>影响服务数:</strong> ${simulation.impactSummary.totalAffectedServices}</p>
    <p><strong>直接依赖:</strong> ${simulation.impactSummary.directlyAffected}</p>
    <p><strong>间接影响:</strong> ${simulation.impactSummary.indirectlyAffected}</p>
  </div>
  <div style="background: white; border-radius: 12px; padding: 25px; margin-top: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
    <h2 style="margin: 0 0 15px 0; color: #1a202c;">恢复建议</h2>
    ${simulation.recoveryRecommendations.slice(0, 5).map(r => {
      const color = r.priority === 'critical' || r.priority === 'immediate' ? '#e53e3e' : r.priority === 'high' ? '#d69e2e' : '#4299e1';
      return `
      <div style="padding: 10px; background: #f7fafc; border-radius: 8px; margin-bottom: 8px;">
        <strong style="color: ${color};">
          [${r.priority.toUpperCase()}]
        </strong>
        ${r.action}
        <div style="color: #718096; font-size: 13px; margin-top: 4px;">${r.reason}</div>
      </div>
    `;
    }).join('')}
  </div>
</div>`;
  }

  _buildAnalysisSubject(analysis) {
    const status = analysis.health.summary.overallStatus;
    const emoji = status === 'healthy' ? '✅' : status === 'degraded' ? '⚠️' : '❌';
    return `${emoji} [集群诊断] 健康评分 ${analysis.health.summary.overallScore}/100 - ${new Date().toLocaleString()}`;
  }

  _buildAnalysisText(analysis) {
    const summary = analysis.health.summary;
    let text = `集群诊断报告\n`;
    text += `================================\n\n`;
    text += `生成时间: ${new Date().toLocaleString()}\n`;
    text += `整体状态: ${summary.overallStatus}\n`;
    text += `健康评分: ${summary.overallScore}/100\n\n`;
    text += `服务统计:\n`;
    text += `  健康: ${summary.healthy}\n`;
    text += `  性能下降: ${summary.degraded}\n`;
    text += `  异常: ${summary.unhealthy}\n\n`;
    text += `\n--\n由 ms-topology CLI 自动发送`;
    return text;
  }

  _buildAnalysisHtml(analysis) {
    const summary = analysis.health.summary;
    const statusColor = summary.overallStatus === 'healthy' ? '#38a169' : summary.overallStatus === 'degraded' ? '#d69e2e' : '#e53e3e';

    return `
<div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 12px;">
    <h1 style="margin: 0; font-size: 24px;">🔍 集群诊断报告</h1>
    <p style="margin: 10px 0 0 0;">生成时间: ${new Date().toLocaleString()}</p>
  </div>
  <div style="background: white; border-radius: 12px; padding: 25px; margin-top: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
    <div style="text-align: center; margin-bottom: 20px;">
      <div style="font-size: 48px; font-weight: bold; color: ${statusColor};">${summary.overallScore}/100</div>
      <div style="font-size: 18px; color: #718096;">整体健康评分</div>
    </div>
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px;">
      <div style="background: #c6f6d5; padding: 15px; border-radius: 8px; text-align: center;">
        <div style="font-size: 24px; font-weight: bold; color: #22543d;">${summary.total}</div>
        <div style="font-size: 13px; color: #2f855a;">总服务</div>
      </div>
      <div style="background: #c6f6d5; padding: 15px; border-radius: 8px; text-align: center;">
        <div style="font-size: 24px; font-weight: bold; color: #22543d;">${summary.healthy}</div>
        <div style="font-size: 13px; color: #2f855a;">健康</div>
      </div>
      <div style="background: #fefcbf; padding: 15px; border-radius: 8px; text-align: center;">
        <div style="font-size: 24px; font-weight: bold; color: #744210;">${summary.degraded}</div>
        <div style="font-size: 13px; color: #b7791f;">性能下降</div>
      </div>
      <div style="background: #fed7d7; padding: 15px; border-radius: 8px; text-align: center;">
        <div style="font-size: 24px; font-weight: bold; color: #742a2a;">${summary.unhealthy}</div>
        <div style="font-size: 13px; color: #c53030;">异常</div>
      </div>
    </div>
  </div>
</div>`;
  }

  async verify() {
    try {
      await this.transporter.verify();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = EmailNotifier;
