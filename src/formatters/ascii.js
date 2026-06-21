const chalk = require('chalk');
const Table = require('cli-table3');

class AsciiFormatter {
  constructor(analysis, options = {}) {
    this.analysis = analysis;
    this.options = options;
    this.color = options.color !== false;
    this.showDetails = options.showDetails !== false;
    this.termWidth = options.termWidth || 120;
  }

  format() {
    const output = [];
    output.push(this.renderHeader());
    output.push('');
    output.push(this.renderHealthSummary());
    output.push('');
    output.push(this.renderTopologyGraph());
    output.push('');

    if (this.showDetails) {
      output.push(this.renderPerformanceSummary());
      output.push('');
      output.push(this.renderCriticalPath());
      output.push('');
      output.push(this.renderServiceDetails());
      output.push('');
      output.push(this.renderBottlenecks());
      output.push('');
      output.push(this.renderWarnings());
    }

    return output.join('\n');
  }

  renderHeader() {
    const title = '微服务依赖拓扑诊断报告';
    const subtitle = `生成时间: ${new Date().toLocaleString()}`;
    const line = '═'.repeat(Math.max(title.length, subtitle.length) + 4);

    let result = '';
    if (this.color) {
      result += chalk.cyan.bold(line) + '\n';
      result += chalk.cyan.bold(`  ${title}`) + '\n';
      result += chalk.gray(`  ${subtitle}`) + '\n';
      result += chalk.cyan.bold(line);
    } else {
      result += line + '\n' + `  ${title}\n` + `  ${subtitle}\n` + line;
    }
    return result;
  }

  renderHealthSummary() {
    const { summary } = this.analysis.health;
    const table = new Table({
      head: ['总服务数', '健康', '性能下降', '异常', '整体健康分', '整体状态'],
      colWidths: [12, 10, 12, 10, 14, 12]
    });

    let statusText = summary.overallStatus;
    if (this.color) {
      if (summary.overallStatus === 'healthy') statusText = chalk.green.bold(statusText);
      else if (summary.overallStatus === 'degraded') statusText = chalk.yellow.bold(statusText);
      else statusText = chalk.red.bold(statusText);
    }

    table.push([
      summary.total,
      this.color ? chalk.green(summary.healthy) : summary.healthy,
      this.color ? chalk.yellow(summary.degraded) : summary.degraded,
      this.color ? chalk.red(summary.unhealthy) : summary.unhealthy,
      `${summary.overallScore}/100`,
      statusText
    ]);

    let result = '';
    result += this.color ? chalk.bold.white('【集群健康状态汇总】') : '【集群健康状态汇总】';
    result += '\n' + table.toString();
    return result;
  }

  renderTopologyGraph() {
    const serviceCount = this.analysis.services.length;
    const compact = serviceCount > 20;
    return compact
      ? this.renderCompactTopology()
      : this.renderBoxTopology();
  }

  renderBoxTopology() {
    const { layers, grouped } = this.analysis.dependencies.layers;
    const { adjacencyList } = this.analysis.dependencies;
    const { criticalPath } = this.analysis.criticalPath;
    const healthStatus = this.analysis.health.services;

    const maxLayer = Math.max(...Object.keys(grouped).map(Number), 0);
    const cpSet = new Set(criticalPath);

    let result = '';
    result += this.color ? chalk.bold.white('【服务依赖拓扑图】') + '\n\n' : '【服务依赖拓扑图】\n\n';

    for (let layer = 0; layer <= maxLayer; layer++) {
      const services = grouped[layer] || [];
      const layerLabel = this.color ? chalk.cyan(`L${layer}`) : `L${layer}`;
      result += `${layerLabel} `;

      const nodeStrs = services.map(s => {
        const h = healthStatus[s];
        const isCP = cpSet.has(s);
        const node = this.formatCompactNode(s, h, isCP);
        return node;
      });

      result += nodeStrs.join('  ');
      result += '\n';

      const edges = [];
      services.forEach(s => {
        (adjacencyList[s] || []).forEach(e => {
          const targetLayer = layers[e.service];
          if (targetLayer === layer + 1) {
            edges.push({ from: s, to: e.service });
          }
        });
      });

      if (edges.length > 0 && layer < maxLayer) {
        result += '    ';
        const edgeStrs = edges.map(e => {
          const arrow = this.color ? chalk.gray(`${e.from} → ${e.to}`) : `${e.from} -> ${e.to}`;
          return arrow;
        });
        result += edgeStrs.join('  ');
        result += '\n';
      }
    }

    result += '\n' + this.renderLegend();
    return result;
  }

  renderCompactTopology() {
    const { layers, grouped } = this.analysis.dependencies.layers;
    const { adjacencyList } = this.analysis.dependencies;
    const { criticalPath } = this.analysis.criticalPath;
    const healthStatus = this.analysis.health.services;
    const cpSet = new Set(criticalPath);

    let result = '';
    result += this.color ? chalk.bold.white('【服务依赖拓扑图 (紧凑模式)】') + '\n\n' : '【服务依赖拓扑图 (紧凑模式)】\n\n';

    const maxLayer = Math.max(...Object.keys(grouped).map(Number), 0);

    for (let layer = 0; layer <= maxLayer; layer++) {
      const services = grouped[layer] || [];
      const layerLabel = this.color ? chalk.cyan(`[L${layer}]`) : `[L${layer}]`;
      result += `${layerLabel} `;

      const cols = Math.max(1, Math.floor((this.termWidth - 8) / 22));
      for (let i = 0; i < services.length; i += cols) {
        if (i > 0) result += '      ';
        const chunk = services.slice(i, i + cols);
        const nodeStrs = chunk.map(s => {
          const h = healthStatus[s];
          const isCP = cpSet.has(s);
          return this.formatCompactNode(s, h, isCP);
        });
        result += nodeStrs.join(' ');
        result += '\n';
      }
    }

    result += '\n';
    result += this.color ? chalk.bold.white('【调用关系 (Edge List)】') + '\n' : '【调用关系 (Edge List)】\n';

    const allEdges = [];
    for (let layer = 0; layer <= maxLayer; layer++) {
      const services = grouped[layer] || [];
      services.forEach(s => {
        (adjacencyList[s] || []).forEach(e => {
          allEdges.push({ from: s, to: e.service, latency: e.avgLatency, errorRate: e.errorRate, cb: e.circuitBreaker });
        });
      });
    }

    const edgeTable = new Table({
      head: ['调用方', '→', '被调方', '延迟ms', '错误率%', '熔断'],
      colWidths: [20, 3, 20, 10, 10, 12]
    });

    allEdges.forEach(e => {
      let latencyText = String(e.latency);
      let errorText = e.errorRate.toFixed(2);
      let cbText = this.formatCBStatus(e.cb);

      if (this.color) {
        if (e.latency > 100) latencyText = chalk.red(latencyText);
        else if (e.latency > 50) latencyText = chalk.yellow(latencyText);
        else latencyText = chalk.green(latencyText);

        if (e.errorRate > 2) errorText = chalk.red(errorText);
        else if (e.errorRate > 1) errorText = chalk.yellow(errorText);
        else errorText = chalk.green(errorText);
      }

      edgeTable.push([e.from, '→', e.to, latencyText, errorText, cbText]);
    });

    result += edgeTable.toString();
    result += '\n\n' + this.renderLegend();
    return result;
  }

  formatCompactNode(service, health, isInCriticalPath) {
    const status = health?.healthStatus || 'unknown';
    const score = health?.score ?? '?';
    let symbol = this.getStatusSymbol(status);
    let cp = isInCriticalPath ? '★' : ' ';
    const displayName = service.length > 18 ? service.substring(0, 15) + '..' : service;

    let node = `[${symbol}${cp} ${displayName} ${score}]`;

    if (this.color) {
      if (status === 'healthy') node = chalk.green(node);
      else if (status === 'degraded') node = chalk.yellow(node);
      else if (status === 'unhealthy') node = chalk.red(node);
      if (isInCriticalPath) node = chalk.bold(node);
    }
    return node;
  }

  formatCBStatus(cb) {
    if (!cb) return '-';
    const state = cb.state || 'closed';
    if (this.color) {
      if (state === 'open') return chalk.red('OPEN');
      if (state === 'half-open') return chalk.yellow('HALF-OPEN');
      return chalk.green('CLOSED');
    }
    return state.toUpperCase();
  }

  getStatusSymbol(status) {
    switch (status) {
      case 'healthy': return '●';
      case 'degraded': return '◐';
      case 'unhealthy': return '✗';
      default: return '?';
    }
  }

  renderLegend() {
    let result = '';
    if (this.color) {
      result += chalk.gray('图例: ') + '\n';
      result += chalk.green('  ● 健康') + '  ';
      result += chalk.yellow('  ◐ 性能下降') + '  ';
      result += chalk.red('  ✗ 异常') + '  ';
      result += chalk.bold('  ★ 关键路径') + '\n';
      result += chalk.green('  熔断:CLOSED') + '  ';
      result += chalk.yellow('  熔断:HALF-OPEN') + '  ';
      result += chalk.red('  熔断:OPEN') + '\n';
      result += chalk.gray('  框内数字为健康评分 (0-100)');
    } else {
      result += '图例: \n';
      result += '  ● 健康  ◐ 性能下降  ✗ 异常  ★ 关键路径\n';
      result += '  熔断:CLOSED  熔断:HALF-OPEN  熔断:OPEN\n';
      result += '  框内数字为健康评分 (0-100)';
    }
    return result;
  }

  renderPerformanceSummary() {
    const stats = this.analysis.performance;
    const overallStats = {
      avgLatency: 0,
      avgErrorRate: 0,
      totalRequests: 0,
      slowEdgeCount: stats.slowEdges.length,
      highErrorEdgeCount: stats.highErrorEdges.length
    };

    const edges = Object.values(stats.edgeMetrics);
    if (edges.length > 0) {
      overallStats.avgLatency = Math.round(edges.reduce((sum, e) => sum + e.avgLatency, 0) / edges.length);
      overallStats.avgErrorRate = (edges.reduce((sum, e) => sum + e.errorRate, 0) / edges.length).toFixed(2);
      overallStats.totalRequests = edges.reduce((sum, e) => sum + e.requestCount, 0);
    }

    const table = new Table({
      head: ['平均延迟', '平均错误率', '总请求量', '慢调用数', '高错误调用数'],
      colWidths: [12, 14, 16, 12, 16]
    });

    let latencyText = overallStats.avgLatency + 'ms';
    let errorText = overallStats.avgErrorRate + '%';

    if (this.color) {
      if (overallStats.avgLatency > 100) latencyText = chalk.red(latencyText);
      else if (overallStats.avgLatency > 50) latencyText = chalk.yellow(latencyText);
      else latencyText = chalk.green(latencyText);

      if (parseFloat(overallStats.avgErrorRate) > 2) errorText = chalk.red(errorText);
      else if (parseFloat(overallStats.avgErrorRate) > 1) errorText = chalk.yellow(errorText);
      else errorText = chalk.green(errorText);
    }

    table.push([
      latencyText,
      errorText,
      overallStats.totalRequests.toLocaleString(),
      this.color ? chalk.red(overallStats.slowEdgeCount) : overallStats.slowEdgeCount,
      this.color ? chalk.red(overallStats.highErrorEdgeCount) : overallStats.highErrorEdgeCount
    ]);

    let result = '';
    result += this.color ? chalk.bold.white('【性能指标汇总】') : '【性能指标汇总】';
    result += '\n' + table.toString();
    return result;
  }

  renderCriticalPath() {
    const { criticalPath, totalDuration, bottleneckServices } = this.analysis.criticalPath;

    let result = '';
    if (this.color) {
      result += chalk.bold.white('【关键路径分析】') + '\n';
      result += chalk.gray(`总耗时: ${totalDuration}ms`) + '\n\n';
    } else {
      result += '【关键路径分析】\n';
      result += `总耗时: ${totalDuration}ms\n\n`;
    }

    let pathStr = '';
    criticalPath.forEach((service, index) => {
      const health = this.analysis.health.services[service];
      let serviceText = service;

      if (this.color) {
        if (health?.healthStatus === 'healthy') serviceText = chalk.green(serviceText);
        else if (health?.healthStatus === 'degraded') serviceText = chalk.yellow(serviceText);
        else if (health?.healthStatus === 'unhealthy') serviceText = chalk.red(serviceText);
        serviceText = chalk.bold(serviceText);
      }

      pathStr += serviceText;
      if (index < criticalPath.length - 1) {
        pathStr += this.color ? chalk.cyan(' → ') : ' → ';
      }
    });

    result += `  ${pathStr}\n\n`;

    if (bottleneckServices.length > 0) {
      result += this.color ? chalk.red.bold('关键路径上的瓶颈服务:') + '\n' : '关键路径上的瓶颈服务:\n';
      bottleneckServices.forEach(b => {
        let severity = b.severity.toUpperCase();
        if (this.color) {
          if (b.severity === 'critical') severity = chalk.red.bold(severity);
          else if (b.severity === 'high') severity = chalk.red(severity);
          else if (b.severity === 'medium') severity = chalk.yellow(severity);
        }
        result += `  [${severity}] ${b.service}: ${b.issues.join(', ')}\n`;
      });
    }

    return result;
  }

  renderServiceDetails() {
    const table = new Table({
      head: ['服务名', '状态', '实例', 'CPU%', '内存%', '平均延迟', '错误率%', '健康分'],
      colWidths: [22, 10, 8, 8, 10, 12, 10, 10]
    });

    const services = Object.values(this.analysis.health.services);
    services.forEach(service => {
      const perf = this.analysis.performance.serviceMetrics[service.name];

      let statusText = service.healthStatus;
      let latencyText = perf?.avgIncomingLatency ? `${Math.round(perf.avgIncomingLatency)}ms` : '-';
      let errorText = perf?.errorRate ? perf.errorRate.toFixed(2) : '-';

      if (this.color) {
        if (service.healthStatus === 'healthy') statusText = chalk.green(statusText);
        else if (service.healthStatus === 'degraded') statusText = chalk.yellow(statusText);
        else if (service.healthStatus === 'unhealthy') statusText = chalk.red(statusText);

        if (perf?.avgIncomingLatency > 100) latencyText = chalk.red(latencyText);
        else if (perf?.avgIncomingLatency > 50) latencyText = chalk.yellow(latencyText);

        if (perf?.errorRate > 2) errorText = chalk.red(errorText);
        else if (perf?.errorRate > 1) errorText = chalk.yellow(errorText);
      }

      table.push([
        service.name,
        statusText,
        service.instanceCount,
        service.cpuUsage,
        service.memoryUsage,
        latencyText,
        errorText,
        `${service.score}/100`
      ]);
    });

    let result = '';
    result += this.color ? chalk.bold.white('【服务详细信息】') : '【服务详细信息】';
    result += '\n' + table.toString();
    return result;
  }

  renderBottlenecks() {
    const { bottlenecks } = this.analysis.performance;
    if (bottlenecks.length === 0) return '';

    let result = '';
    result += this.color ? chalk.bold.white('【性能瓶颈分析】') : '【性能瓶颈分析】';

    bottlenecks.slice(0, 5).forEach(b => {
      let loadText = `[负载: ${Math.round(b.load)}]`;
      if (this.color) {
        if (b.load > 80) loadText = chalk.red.bold(loadText);
        else if (b.load > 50) loadText = chalk.yellow(loadText);
      }
      result += `  ${b.edge} ${loadText}\n`;
      b.issues.forEach(issue => {
        result += `    - ${issue.message}\n`;
      });
    });

    return result;
  }

  renderWarnings() {
    const { warnings } = this.analysis.health;
    if (warnings.length === 0) return '';

    let result = '';
    result += this.color ? chalk.bold.white('【警告信息】') : '【警告信息】';

    warnings.forEach(w => {
      let prefix = '●';
      if (this.color) {
        if (w.severity === 'critical') prefix = chalk.red.bold(prefix);
        else if (w.severity === 'warning') prefix = chalk.yellow(prefix);
        else prefix = chalk.blue(prefix);
      }
      result += `  ${prefix} ${w.message}\n`;
    });

    return result;
  }
}

module.exports = AsciiFormatter;
