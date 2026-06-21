const chalk = require('chalk');
const Table = require('cli-table3');

class AsciiFormatter {
  constructor(analysis, options = {}) {
    this.analysis = analysis;
    this.options = options;
    this.color = options.color !== false;
    this.showDetails = options.showDetails !== false;
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
      result += line + '\n';
      result += `  ${title}\n`;
      result += `  ${subtitle}\n`;
      result += line;
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
      if (summary.overallStatus === 'healthy') {
        statusText = chalk.green.bold(statusText);
      } else if (summary.overallStatus === 'degraded') {
        statusText = chalk.yellow.bold(statusText);
      } else {
        statusText = chalk.red.bold(statusText);
      }
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
    if (this.color) {
      result += chalk.bold.white('【集群健康状态汇总】') + '\n';
    } else {
      result += '【集群健康状态汇总】\n';
    }
    result += table.toString();
    return result;
  }

  renderTopologyGraph() {
    const { layers, grouped } = this.analysis.dependencies.layers;
    const { adjacencyList } = this.analysis.dependencies;
    const { criticalPath } = this.analysis.criticalPath;
    const healthStatus = this.analysis.health.services;

    const maxLayer = Math.max(...Object.keys(grouped).map(Number), 0);
    const serviceWidth = 22;
    const padding = 4;

    let result = '';
    if (this.color) {
      result += chalk.bold.white('【服务依赖拓扑图】') + '\n\n';
    } else {
      result += '【服务依赖拓扑图】\n\n';
    }

    const layerPositions = {};
    let maxServicesInLayer = 0;

    for (let layer = 0; layer <= maxLayer; layer++) {
      const services = grouped[layer] || [];
      maxServicesInLayer = Math.max(maxServicesInLayer, services.length);
      
      services.forEach((service, index) => {
        layerPositions[service] = {
          layer,
          index,
          total: services.length
        };
      });
    }

    const totalWidth = (serviceWidth + padding) * maxServicesInLayer;

    for (let layer = 0; layer <= maxLayer; layer++) {
      const services = grouped[layer] || [];
      const layerServiceCount = services.length;
      const spacing = layerServiceCount > 1 
        ? Math.floor((totalWidth - serviceWidth * layerServiceCount) / (layerServiceCount + 1))
        : Math.floor((totalWidth - serviceWidth) / 2);

      let line = ' '.repeat(spacing);
      let connectorLine = '';

      for (let i = 0; i < services.length; i++) {
        const service = services[i];
        const isInCriticalPath = criticalPath.includes(service);
        const health = healthStatus[service];

        let nodeText = this.formatServiceNode(service, health, isInCriticalPath);
        line += nodeText;

        if (i < services.length - 1) {
          line += ' '.repeat(spacing);
        }

        const downstream = adjacencyList[service] || [];
        downstream.forEach(dep => {
          const depPos = layerPositions[dep.service];
          if (depPos && depPos.layer === layer + 1) {
            const fromCenter = serviceWidth / 2;
            const toStart = depPos.index * (serviceWidth + spacing) + spacing + serviceWidth / 2;
            const currentPos = i * (serviceWidth + spacing) + spacing + fromCenter;
            
            let arrowLine = '';
            for (let j = 0; j < totalWidth; j++) {
              if (j === Math.floor(currentPos)) {
                arrowLine += '│';
              } else if (j === Math.floor(toStart) && layer + 1 <= maxLayer) {
                arrowLine += '▼';
              } else {
                arrowLine += ' ';
              }
            }
            connectorLine = arrowLine;
          }
        });
      }

      result += line + '\n';
      if (layer < maxLayer && connectorLine) {
        result += connectorLine + '\n';
      }
    }

    result += '\n';
    result += this.renderLegend();
    
    return result;
  }

  formatServiceNode(service, health, isInCriticalPath) {
    const status = health?.healthStatus || 'unknown';
    const width = 20;
    const displayName = service.length > width - 2 
      ? service.substring(0, width - 5) + '...' 
      : service;
    const padding = Math.floor((width - displayName.length - 2) / 2);
    const rightPad = width - displayName.length - 2 - padding;

    let node = `╔${'═'.repeat(width - 2)}╗\n`;
    node += `║${' '.repeat(padding)}${displayName}${' '.repeat(rightPad)}║\n`;
    
    let statusSymbol = this.getStatusSymbol(status);
    let cpSymbol = isInCriticalPath ? '★' : ' ';
    node += `║ ${statusSymbol} ${cpSymbol} ${health?.score?.toString().padStart(3) || '?'}分    ║\n`;
    node += `╚${'═'.repeat(width - 2)}╝`;

    if (this.color) {
      if (status === 'healthy') {
        node = chalk.green(node);
      } else if (status === 'degraded') {
        node = chalk.yellow(node);
      } else if (status === 'unhealthy') {
        node = chalk.red(node);
      }
      if (isInCriticalPath) {
        node = chalk.bold(node);
      }
    }

    return node;
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
      result += chalk.gray('  框内数字为健康评分 (0-100)');
    } else {
      result += '图例: \n';
      result += '  ● 健康  ◐ 性能下降  ✗ 异常  ★ 关键路径\n';
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
    if (this.color) {
      result += chalk.bold.white('【性能指标汇总】') + '\n';
    } else {
      result += '【性能指标汇总】\n';
    }
    result += table.toString();
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
        if (health?.healthStatus === 'healthy') {
          serviceText = chalk.green(serviceText);
        } else if (health?.healthStatus === 'degraded') {
          serviceText = chalk.yellow(serviceText);
        } else if (health?.healthStatus === 'unhealthy') {
          serviceText = chalk.red(serviceText);
        }
        serviceText = chalk.bold(serviceText);
      }

      pathStr += serviceText;
      if (index < criticalPath.length - 1) {
        pathStr += this.color ? chalk.cyan(' → ') : ' → ';
      }
    });

    result += `  ${pathStr}\n\n`;

    if (bottleneckServices.length > 0) {
      if (this.color) {
        result += chalk.red.bold('关键路径上的瓶颈服务:') + '\n';
      } else {
        result += '关键路径上的瓶颈服务:\n';
      }
      
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
      let latencyText = perf?.avgIncomingLatency 
        ? `${Math.round(perf.avgIncomingLatency)}ms` 
        : '-';
      let errorText = perf?.errorRate 
        ? perf.errorRate.toFixed(2) 
        : '-';

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
    if (this.color) {
      result += chalk.bold.white('【服务详细信息】') + '\n';
    } else {
      result += '【服务详细信息】\n';
    }
    result += table.toString();
    return result;
  }

  renderBottlenecks() {
    const { bottlenecks } = this.analysis.performance;
    
    if (bottlenecks.length === 0) {
      return '';
    }

    let result = '';
    if (this.color) {
      result += chalk.bold.white('【性能瓶颈分析】') + '\n';
    } else {
      result += '【性能瓶颈分析】\n';
    }

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
    
    if (warnings.length === 0) {
      return '';
    }

    let result = '';
    if (this.color) {
      result += chalk.bold.white('【警告信息】') + '\n';
    } else {
      result += '【警告信息】\n';
    }

    warnings.forEach(w => {
      let prefix = '●';
      if (this.color) {
        if (w.severity === 'critical') {
          prefix = chalk.red.bold(prefix);
        } else if (w.severity === 'warning') {
          prefix = chalk.yellow(prefix);
        } else {
          prefix = chalk.blue(prefix);
        }
      }
      result += `  ${prefix} ${w.message}\n`;
    });

    return result;
  }
}

module.exports = AsciiFormatter;
