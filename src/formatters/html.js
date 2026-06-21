const fs = require('fs');
const path = require('path');

class HtmlFormatter {
  constructor(analysis, options = {}) {
    this.analysis = analysis;
    this.options = options;
    this.outputPath = options.outputPath || 'topology-report.html';
  }

  format() {
    const html = this.generateHtml();
    if (this.options.writeToFile !== false) {
      const outputPath = path.resolve(this.outputPath);
      fs.writeFileSync(outputPath, html, 'utf8');
      return `HTML报告已生成: ${outputPath}`;
    }
    return html;
  }

  generateHtml() {
    const health = this.analysis.health;
    const performance = this.analysis.performance;
    const criticalPath = this.analysis.criticalPath;
    const dependencies = this.analysis.dependencies;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>微服务依赖拓扑诊断报告</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #333;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    .header {
      background: white;
      border-radius: 12px;
      padding: 30px;
      margin-bottom: 20px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.1);
    }
    .header h1 { font-size: 28px; color: #1a202c; margin-bottom: 10px; }
    .header .subtitle { color: #718096; font-size: 14px; }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-bottom: 20px;
    }
    .summary-card {
      background: white;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.1);
      text-align: center;
    }
    .summary-card .label { font-size: 13px; color: #718096; margin-bottom: 8px; }
    .summary-card .value { font-size: 32px; font-weight: bold; color: #1a202c; }
    .summary-card.healthy .value { color: #38a169; }
    .summary-card.degraded .value { color: #d69e2e; }
    .summary-card.unhealthy .value { color: #e53e3e; }
    .section {
      background: white;
      border-radius: 12px;
      padding: 25px;
      margin-bottom: 20px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.1);
    }
    .section h2 {
      font-size: 20px;
      color: #1a202c;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid #e2e8f0;
    }
    .health-score { display: flex; align-items: center; gap: 15px; margin-bottom: 20px; }
    .score-circle {
      width: 100px; height: 100px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 28px; font-weight: bold; color: white;
    }
    .score-circle.healthy { background: conic-gradient(#38a169 var(--score), #e2e8f0 0); }
    .score-circle.degraded { background: conic-gradient(#d69e2e var(--score), #e2e8f0 0); }
    .score-circle.unhealthy { background: conic-gradient(#e53e3e var(--score), #e2e8f0 0); }
    .topology-container { overflow-x: auto; padding: 20px; background: #f7fafc; border-radius: 8px; }
    .topology-layer {
      display: flex; justify-content: center; gap: 20px;
      margin-bottom: 30px; position: relative; flex-wrap: wrap;
    }
    .service-node {
      min-width: 160px; max-width: 200px; padding: 12px;
      border-radius: 10px; text-align: center; position: relative;
      transition: transform 0.3s, box-shadow 0.3s; cursor: pointer;
    }
    .service-node:hover { transform: translateY(-5px); box-shadow: 0 8px 25px rgba(0,0,0,0.15); }
    .service-node.healthy { background: linear-gradient(135deg, #c6f6d5, #9ae6b4); border: 2px solid #38a169; }
    .service-node.degraded { background: linear-gradient(135deg, #fefcbf, #faf089); border: 2px solid #d69e2e; }
    .service-node.unhealthy { background: linear-gradient(135deg, #fed7d7, #feb2b2); border: 2px solid #e53e3e; }
    .service-node.critical { box-shadow: 0 0 20px rgba(102, 126, 234, 0.5); }
    .service-node .name { font-weight: bold; font-size: 13px; margin-bottom: 6px; word-break: break-all; }
    .service-node .score { font-size: 22px; font-weight: bold; }
    .service-node .badge {
      position: absolute; top: -8px; right: -8px; width: 24px; height: 24px;
      background: #667eea; color: white; border-radius: 50%;
      display: flex; align-items: center; justify-content: center; font-size: 12px;
    }
    .cb-indicator {
      display: inline-block; padding: 2px 6px; border-radius: 4px;
      font-size: 10px; font-weight: 600; margin-top: 4px;
    }
    .cb-indicator.closed { background: #c6f6d5; color: #22543d; }
    .cb-indicator.open { background: #fed7d7; color: #742a2a; }
    .cb-indicator.half-open { background: #fefcbf; color: #744210; }
    .edge-table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    .edge-table th, .edge-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
    .edge-table th { background: #f7fafc; font-weight: 600; color: #4a5568; }
    .edge-table tr:hover { background: #f7fafc; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background: #f7fafc; font-weight: 600; color: #4a5568; }
    tr:hover { background: #f7fafc; }
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .status-badge.healthy { background: #c6f6d5; color: #22543d; }
    .status-badge.degraded { background: #fefcbf; color: #744210; }
    .status-badge.unhealthy { background: #fed7d7; color: #742a2a; }
    .critical-path {
      display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
      padding: 20px; background: #f0fff4; border-radius: 8px; margin-bottom: 20px;
    }
    .critical-path .node { padding: 10px 18px; background: white; border-radius: 8px; font-weight: 600; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .critical-path .arrow { font-size: 20px; color: #667eea; }
    .bottleneck-item { padding: 15px; background: #fff5f5; border-left: 4px solid #e53e3e; border-radius: 4px; margin-bottom: 10px; }
    .bottleneck-item.medium { background: #fffaf0; border-left-color: #d69e2e; }
    .warning-item { padding: 12px 15px; background: #fffaf0; border-radius: 6px; margin-bottom: 8px; display: flex; align-items: center; gap: 10px; }
    .warning-item.critical { background: #fff5f5; }
    .warning-icon { width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; color: white; flex-shrink: 0; }
    .warning-icon.critical { background: #e53e3e; }
    .warning-icon.warning { background: #d69e2e; }
    .warning-icon.info { background: #4299e1; }
    .legend { display: flex; gap: 20px; flex-wrap: wrap; margin-top: 15px; padding: 15px; background: #f7fafc; border-radius: 8px; }
    .legend-item { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .legend-color { width: 16px; height: 16px; border-radius: 4px; }
    .progress-bar { height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 4px; transition: width 0.5s; }
    .progress-fill.good { background: #38a169; }
    .progress-fill.warning { background: #d69e2e; }
    .progress-fill.danger { background: #e53e3e; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔍 微服务依赖拓扑诊断报告</h1>
      <p class="subtitle">生成时间: ${new Date().toLocaleString()}</p>
    </div>
    ${this.renderSummaryCards(health)}
    ${this.renderHealthScore(health)}
    ${this.renderTopologyGraph(health, criticalPath, dependencies)}
    ${this.renderEdgeTable(dependencies)}
    ${this.renderPerformanceSummary(performance)}
    ${this.renderCriticalPath(criticalPath, health)}
    ${this.renderServiceTable(health, performance)}
    ${this.renderBottlenecks(performance)}
    ${this.renderWarnings(health)}
  </div>
</body>
</html>`;
  }

  renderSummaryCards(health) {
    const { summary } = health;
    return `
    <div class="summary-grid">
      <div class="summary-card"><div class="label">总服务数</div><div class="value">${summary.total}</div></div>
      <div class="summary-card healthy"><div class="label">健康</div><div class="value">${summary.healthy}</div></div>
      <div class="summary-card degraded"><div class="label">性能下降</div><div class="value">${summary.degraded}</div></div>
      <div class="summary-card unhealthy"><div class="label">异常</div><div class="value">${summary.unhealthy}</div></div>
    </div>`;
  }

  renderHealthScore(health) {
    const { summary } = health;
    const statusClass = summary.overallStatus;
    const scorePercent = summary.overallScore;
    return `
    <div class="section">
      <h2>💚 集群健康状态</h2>
      <div class="health-score">
        <div class="score-circle ${statusClass}" style="--score: ${scorePercent}%">${scorePercent}</div>
        <div>
          <div style="font-size: 24px; font-weight: bold; margin-bottom: 5px;">
            ${summary.overallStatus === 'healthy' ? '✅ 集群运行正常' : summary.overallStatus === 'degraded' ? '⚠️ 集群性能下降' : '❌ 集群存在异常'}
          </div>
          <div style="color: #718096;">整体健康评分: ${scorePercent}/100</div>
        </div>
      </div>
    </div>`;
  }

  renderTopologyGraph(health, criticalPath, dependencies) {
    const { grouped } = dependencies.layers;
    const maxLayer = Math.max(...Object.keys(grouped).map(Number), 0);
    const healthServices = health.services;
    const cpSet = new Set(criticalPath.criticalPath);
    const adj = dependencies.adjacencyList;

    let layersHtml = '';
    for (let layer = 0; layer <= maxLayer; layer++) {
      const services = grouped[layer] || [];
      let servicesHtml = services.map(service => {
        const serviceHealth = healthServices[service];
        const status = serviceHealth?.healthStatus || 'unknown';
        const isCritical = cpSet.has(service);

        const edges = (adj[service] || []).filter(e => {
          const targetLayer = dependencies.layers.layers[e.service];
          return targetLayer === layer + 1;
        });

        let cbHtml = '';
        edges.forEach(e => {
          if (e.circuitBreaker) {
            const state = e.circuitBreaker.state;
            cbHtml += `<span class="cb-indicator ${state}">${state === 'open' ? '熔断OPEN' : state === 'half-open' ? '半开' : '熔断OK'}</span> `;
          }
        });

        let fallbackHtml = '';
        edges.forEach(e => {
          if (e.fallback) {
            fallbackHtml += `<div style="font-size:10px;color:#667eea;margin-top:2px;">↓${e.fallback.target}</div>`;
          }
        });

        return `
          <div class="service-node ${status} ${isCritical ? 'critical' : ''}">
            ${isCritical ? '<div class="badge">★</div>' : ''}
            <div class="name">${service}</div>
            <div class="score">${serviceHealth?.score || '?'}</div>
            <div style="font-size: 11px; margin-top: 4px;">CPU: ${serviceHealth?.cpuUsage || 0}% | 内存: ${serviceHealth?.memoryUsage || 0}%</div>
            ${cbHtml ? `<div style="margin-top:4px;">${cbHtml}</div>` : ''}
            ${fallbackHtml}
          </div>`;
      }).join('');
      layersHtml += `<div class="topology-layer"><div style="font-size:12px;color:#718096;margin-bottom:8px;width:100%;text-align:center;">Layer ${layer}</div>${servicesHtml}</div>`;
    }

    return `
    <div class="section">
      <h2>🌐 服务依赖拓扑图</h2>
      <div class="topology-container">${layersHtml}</div>
      <div class="legend">
        <div class="legend-item"><div class="legend-color" style="background: #9ae6b4;"></div><span>健康</span></div>
        <div class="legend-item"><div class="legend-color" style="background: #faf089;"></div><span>性能下降</span></div>
        <div class="legend-item"><div class="legend-color" style="background: #feb2b2;"></div><span>异常</span></div>
        <div class="legend-item"><div class="legend-color" style="background: #667eea;"></div><span>★ 关键路径</span></div>
        <div class="legend-item"><span class="cb-indicator closed">熔断OK</span></div>
        <div class="legend-item"><span class="cb-indicator half-open">半开</span></div>
        <div class="legend-item"><span class="cb-indicator open">熔断OPEN</span></div>
      </div>
    </div>`;
  }

  renderEdgeTable(dependencies) {
    const adj = dependencies.adjacencyList;
    const edges = [];
    const seen = new Set();
    for (const [from, neighbors] of Object.entries(adj)) {
      for (const e of neighbors) {
        const key = `${from}->${e.service}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push(e);
        }
      }
    }

    if (edges.length === 0) return '';

    const rowsHtml = edges.map(e => {
      const cbState = e.circuitBreaker ? e.circuitBreaker.state : null;
      const cbHtml = cbState
        ? `<span class="cb-indicator ${cbState}">${cbState === 'open' ? 'OPEN' : cbState === 'half-open' ? 'HALF-OPEN' : 'CLOSED'}</span>`
        : '-';
      const retryHtml = e.retry ? `${e.retry.maxRetries}次/${e.retry.backoffMs}ms` : '-';
      const fallbackHtml = e.fallback ? `${e.fallback.target} (${Math.round(e.fallback.successRate * 100)}%)` : '-';
      const latencyColor = e.avgLatency > 100 ? '#e53e3e' : e.avgLatency > 50 ? '#d69e2e' : '#38a169';
      const errorColor = e.errorRate > 2 ? '#e53e3e' : e.errorRate > 1 ? '#d69e2e' : '#38a169';

      return `<tr>
        <td>${(Object.entries(adj).find(([k, v]) => v.includes(e)) || ['?'])[0]}</td>
        <td>→</td>
        <td>${e.service}</td>
        <td style="color:${latencyColor};font-weight:600;">${e.avgLatency}ms</td>
        <td style="color:${errorColor};font-weight:600;">${e.errorRate.toFixed(2)}%</td>
        <td>${e.requestCount.toLocaleString()}</td>
        <td>${cbHtml}</td>
        <td>${retryHtml}</td>
        <td>${fallbackHtml}</td>
      </tr>`;
    }).join('');

    const allRows = [];
    for (const [from, neighbors] of Object.entries(adj)) {
      for (const e of neighbors) {
        const cbState = e.circuitBreaker ? e.circuitBreaker.state : null;
        const cbHtml = cbState
          ? `<span class="cb-indicator ${cbState}">${cbState === 'open' ? 'OPEN' : cbState === 'half-open' ? 'HALF-OPEN' : 'CLOSED'}</span>`
          : '-';
        const retryHtml = e.retry ? `${e.retry.maxRetries}次/${e.retry.backoffMs}ms` : '-';
        const fallbackHtml = e.fallback ? `${e.fallback.target} (${Math.round(e.fallback.successRate * 100)}%)` : '-';
        const latencyColor = e.avgLatency > 100 ? '#e53e3e' : e.avgLatency > 50 ? '#d69e2e' : '#38a169';
        const errorColor = e.errorRate > 2 ? '#e53e3e' : e.errorRate > 1 ? '#d69e2e' : '#38a169';

        allRows.push(`<tr>
          <td>${from}</td>
          <td>→</td>
          <td>${e.service}</td>
          <td style="color:${latencyColor};font-weight:600;">${e.avgLatency}ms</td>
          <td style="color:${errorColor};font-weight:600;">${e.errorRate.toFixed(2)}%</td>
          <td>${e.requestCount.toLocaleString()}</td>
          <td>${cbHtml}</td>
          <td>${retryHtml}</td>
          <td>${fallbackHtml}</td>
        </tr>`);
      }
    }

    return `
    <div class="section">
      <h2>🔗 调用关系与熔断器状态</h2>
      <table class="edge-table">
        <thead>
          <tr><th>调用方</th><th></th><th>被调方</th><th>延迟</th><th>错误率</th><th>请求量</th><th>熔断器</th><th>重试</th><th>降级</th></tr>
        </thead>
        <tbody>${allRows.join('')}</tbody>
      </table>
    </div>`;
  }

  renderPerformanceSummary(performance) {
    const edges = Object.values(performance.edgeMetrics);
    const avgLatency = edges.length > 0 ? Math.round(edges.reduce((sum, e) => sum + e.avgLatency, 0) / edges.length) : 0;
    const avgErrorRate = edges.length > 0 ? (edges.reduce((sum, e) => sum + e.errorRate, 0) / edges.length).toFixed(2) : 0;
    const totalRequests = edges.reduce((sum, e) => sum + e.requestCount, 0);
    const latencyClass = avgLatency > 100 ? 'danger' : avgLatency > 50 ? 'warning' : 'good';
    const errorClass = parseFloat(avgErrorRate) > 2 ? 'danger' : parseFloat(avgErrorRate) > 1 ? 'warning' : 'good';

    return `
    <div class="section">
      <h2>📊 性能指标汇总</h2>
      <div class="summary-grid">
        <div class="summary-card"><div class="label">平均延迟</div><div class="value" style="font-size: 24px;">${avgLatency}ms</div><div class="progress-bar" style="margin-top: 10px;"><div class="progress-fill ${latencyClass}" style="width: ${Math.min(avgLatency / 2, 100)}%"></div></div></div>
        <div class="summary-card"><div class="label">平均错误率</div><div class="value" style="font-size: 24px;">${avgErrorRate}%</div><div class="progress-bar" style="margin-top: 10px;"><div class="progress-fill ${errorClass}" style="width: ${Math.min(parseFloat(avgErrorRate) * 10, 100)}%"></div></div></div>
        <div class="summary-card"><div class="label">总请求量</div><div class="value" style="font-size: 24px;">${totalRequests.toLocaleString()}</div></div>
        <div class="summary-card"><div class="label">慢调用/高错误</div><div class="value" style="font-size: 24px;">${performance.slowEdges.length}/${performance.highErrorEdges.length}</div></div>
      </div>
    </div>`;
  }

  renderCriticalPath(criticalPath, health) {
    const { criticalPath: cp, totalDuration, bottleneckServices } = criticalPath;
    const healthServices = health.services;

    let pathHtml = '';
    cp.forEach((service, index) => {
      pathHtml += `<span class="node">${service}</span>`;
      if (index < cp.length - 1) pathHtml += `<span class="arrow">→</span>`;
    });

    let bottlenecksHtml = '';
    if (bottleneckServices.length > 0) {
      bottlenecksHtml = `<h3 style="margin-top: 20px; margin-bottom: 15px; color: #e53e3e;">关键路径上的瓶颈服务</h3>
        ${bottleneckServices.map(b => `
          <div class="bottleneck-item ${b.severity === 'medium' ? 'medium' : ''}">
            <strong>${b.service}</strong> (位置: ${b.position}/${cp.length})
            <div style="margin-top: 8px; color: #718096;">${b.issues.map(i => `• ${i}`).join('<br>')}</div>
          </div>
        `).join('')}`;
    }

    return `
    <div class="section">
      <h2>⚡ 关键路径分析</h2>
      <div style="margin-bottom: 15px; color: #718096;">总耗时: <strong>${totalDuration}ms</strong> | 路径长度: <strong>${cp.length}</strong> 个服务</div>
      <div class="critical-path">${pathHtml}</div>
      ${bottlenecksHtml}
    </div>`;
  }

  renderServiceTable(health, performance) {
    const services = Object.values(health.services);
    let rowsHtml = services.map(service => {
      const perf = performance.serviceMetrics[service.name];
      const latency = perf?.avgIncomingLatency ? `${Math.round(perf.avgIncomingLatency)}ms` : '-';
      const errorRate = perf?.errorRate ? perf.errorRate.toFixed(2) + '%' : '-';
      return `
        <tr>
          <td><strong>${service.name}</strong></td>
          <td><span class="status-badge ${service.healthStatus}">${service.healthStatus}</span></td>
          <td>${service.instanceCount}</td>
          <td>${service.cpuUsage}%</td>
          <td>${service.memoryUsage}%</td>
          <td>${latency}</td>
          <td>${errorRate}</td>
          <td><div style="display: flex; align-items: center; gap: 8px;"><div class="progress-bar" style="width: 60px;"><div class="progress-fill ${service.score >= 80 ? 'good' : service.score >= 50 ? 'warning' : 'danger'}" style="width: ${service.score}%"></div></div><span>${service.score}/100</span></div></td>
        </tr>`;
    }).join('');

    return `
    <div class="section">
      <h2>📋 服务详细信息</h2>
      <table><thead><tr><th>服务名</th><th>状态</th><th>实例数</th><th>CPU</th><th>内存</th><th>平均延迟</th><th>错误率</th><th>健康分</th></tr></thead><tbody>${rowsHtml}</tbody></table>
    </div>`;
  }

  renderBottlenecks(performance) {
    const { bottlenecks } = performance;
    if (bottlenecks.length === 0) {
      return `<div class="section"><h2>🎯 性能瓶颈分析</h2><div style="padding: 20px; text-align: center; color: #718096;">✅ 未发现明显的性能瓶颈</div></div>`;
    }
    const bottlenecksHtml = bottlenecks.slice(0, 5).map(b => `
      <div class="bottleneck-item ${b.load > 80 ? '' : 'medium'}">
        <div style="display: flex; justify-content: space-between; align-items: center;"><strong>${b.edge}</strong><span style="font-size: 12px; color: #718096;">负载指数: ${Math.round(b.load)}</span></div>
        <div style="margin-top: 8px;">${b.issues.map(i => `<div style="color: #718096;">• ${i.message}</div>`).join('')}</div>
      </div>`).join('');

    return `<div class="section"><h2>🎯 性能瓶颈分析</h2>${bottlenecksHtml}</div>`;
  }

  renderWarnings(health) {
    const { warnings } = health;
    if (warnings.length === 0) {
      return `<div class="section"><h2>⚠️ 警告信息</h2><div style="padding: 20px; text-align: center; color: #718096;">✅ 未发现需要关注的警告</div></div>`;
    }
    const warningsHtml = warnings.map(w => `
      <div class="warning-item ${w.severity}">
        <div class="warning-icon ${w.severity}">${w.severity === 'critical' ? '!' : w.severity === 'warning' ? '⚠' : 'ℹ'}</div>
        <span>${w.message}</span>
      </div>`).join('');
    return `<div class="section"><h2>⚠️ 警告信息</h2>${warningsHtml}</div>`;
  }
}

module.exports = HtmlFormatter;
