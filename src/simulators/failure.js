const chalk = require('chalk');

class FailureSimulator {
  constructor(analysis) {
    this.analysis = analysis;
    this.dependencies = analysis.dependencies;
    this.health = analysis.health;
    this.performance = analysis.performance;
    this.criticalPath = analysis.criticalPath;
  }

  simulateFailure(serviceName) {
    if (!this.analysis.services.find(s => s.name === serviceName)) {
      return {
        success: false,
        error: `服务 ${serviceName} 不存在`
      };
    }

    const affectedDownstream = this.getAffectedDownstream(serviceName);
    const affectedUpstream = this.getAffectedUpstream(serviceName);
    const directDependents = this.getDirectDependents(serviceName);
    const criticalPathImpact = this.getCriticalPathImpact(serviceName);
    const trafficImpact = this.getTrafficImpact(serviceName, affectedDownstream);
    const failureSeverity = this.calculateFailureSeverity(serviceName, affectedDownstream, criticalPathImpact);
    const recoveryRecommendations = this.generateRecoveryRecommendations(serviceName, failureSeverity);

    return {
      success: true,
      failedService: serviceName,
      failureSeverity,
      impactSummary: {
        totalAffectedServices: affectedDownstream.length + affectedUpstream.length,
        directlyAffected: directDependents.length,
        indirectlyAffected: affectedDownstream.length - directDependents.length,
        criticalPathImpact,
        trafficImpact
      },
      affectedDownstream,
      affectedUpstream,
      directDependents,
      cascadeRisk: this.assessCascadeRisk(serviceName, affectedDownstream),
      recoveryRecommendations
    };
  }

  getAffectedDownstream(serviceName) {
    const { adjacencyList } = this.dependencies;
    const visited = new Set();
    const affected = [];

    const dfs = (current, depth, path) => {
      if (visited.has(current)) return;
      visited.add(current);

      if (current !== serviceName) {
        const serviceHealth = this.health.services[current];
        const servicePerf = this.performance.serviceMetrics[current];
        
        affected.push({
          service: current,
          depth,
          path: [...path, current],
          impactLevel: this.calculateImpactLevel(depth),
          healthStatus: serviceHealth?.healthStatus || 'unknown',
          instanceCount: serviceHealth?.instanceCount || 0,
          incomingRequests: servicePerf?.totalIncomingRequests || 0,
          failureProbability: this.calculateFailureProbability(depth, serviceHealth)
        });
      }

      const neighbors = adjacencyList[current] || [];
      for (const neighbor of neighbors) {
        dfs(neighbor.service, depth + 1, [...path, current]);
      }
    };

    dfs(serviceName, 0, [serviceName]);
    return affected.sort((a, b) => a.depth - b.depth);
  }

  getAffectedUpstream(serviceName) {
    const { reverseAdjacencyList } = this.dependencies;
    const visited = new Set();
    const affected = [];

    const dfs = (current, depth) => {
      if (visited.has(current)) return;
      visited.add(current);

      if (current !== serviceName) {
        const serviceHealth = this.health.services[current];
        const servicePerf = this.performance.serviceMetrics[current];
        
        affected.push({
          service: current,
          depth,
          impactLevel: this.calculateImpactLevel(depth),
          healthStatus: serviceHealth?.healthStatus || 'unknown',
          outgoingRequests: servicePerf?.totalOutgoingRequests || 0,
          callsToFailed: this.countCallsTo(current, serviceName)
        });
      }

      const neighbors = reverseAdjacencyList[current] || [];
      for (const neighbor of neighbors) {
        dfs(neighbor.service, depth + 1);
      }
    };

    dfs(serviceName, 0);
    return affected.sort((a, b) => a.depth - b.depth);
  }

  getDirectDependents(serviceName) {
    const { reverseAdjacencyList } = this.dependencies;
    const directCallers = reverseAdjacencyList[serviceName] || [];
    
    return directCallers.map(caller => {
      const serviceHealth = this.health.services[caller.service];
      return {
        service: caller.service,
        healthStatus: serviceHealth?.healthStatus || 'unknown',
        avgLatency: caller.avgLatency,
        errorRate: caller.errorRate,
        requestCount: caller.requestCount,
        failureImpact: this.calculateDirectImpact(caller)
      };
    }).sort((a, b) => b.requestCount - a.requestCount);
  }

  getCriticalPathImpact(serviceName) {
    const { criticalPath } = this.criticalPath;
    const isInCriticalPath = criticalPath.includes(serviceName);
    
    if (!isInCriticalPath) {
      return {
        isInCriticalPath: false,
        impact: 'none',
        affectedPaths: 0
      };
    }

    const position = criticalPath.indexOf(serviceName);
    const downstreamOnCP = criticalPath.slice(position + 1);
    
    const topPaths = this.criticalPath.topPaths || [];
    const affectedPathsCount = topPaths.filter(p => p.path.includes(serviceName)).length;

    return {
      isInCriticalPath: true,
      position: position + 1,
      totalPathLength: criticalPath.length,
      downstreamServicesOnCriticalPath: downstreamOnCP,
      affectedPaths: affectedPathsCount,
      totalPaths: topPaths.length,
      impact: downstreamOnCP.length > 0 ? 'critical' : 'high'
    };
  }

  getTrafficImpact(serviceName, affectedDownstream) {
    const servicePerf = this.performance.serviceMetrics[serviceName];
    const directCallers = this.getDirectDependents(serviceName);
    
    const directTrafficLost = directCallers.reduce((sum, c) => sum + c.requestCount, 0);
    const totalTrafficLost = affectedDownstream.reduce((sum, s) => sum + s.incomingRequests, 0);
    
    const allServicesTraffic = Object.values(this.performance.serviceMetrics)
      .reduce((sum, s) => sum + s.totalIncomingRequests, 0);

    return {
      directRequestsPerSecond: directTrafficLost,
      totalAffectedRequestsPerSecond: totalTrafficLost,
      percentageOfTotalTraffic: allServicesTraffic > 0 
        ? ((totalTrafficLost / allServicesTraffic) * 100).toFixed(2)
        : 0,
      directCallersCount: directCallers.length
    };
  }

  calculateFailureSeverity(serviceName, affectedDownstream, criticalPathImpact) {
    let score = 0;

    const serviceHealth = this.health.services[serviceName];
    if (serviceHealth?.instanceCount === 1) score += 25;
    
    if (criticalPathImpact.isInCriticalPath) {
      score += 30;
      if (criticalPathImpact.position <= 2) score += 10;
    }

    score += Math.min(affectedDownstream.length * 5, 25);
    
    const highImpactServices = affectedDownstream.filter(s => s.impactLevel === 'high').length;
    score += Math.min(highImpactServices * 3, 15);

    const trafficImpact = this.getTrafficImpact(serviceName, affectedDownstream);
    const trafficPercent = parseFloat(trafficImpact.percentageOfTotalTraffic);
    if (trafficPercent > 50) score += 30;
    else if (trafficPercent > 30) score += 20;
    else if (trafficPercent > 10) score += 10;

    let severity, level;
    if (score >= 80) {
      severity = 'critical';
      level = 4;
    } else if (score >= 60) {
      severity = 'high';
      level = 3;
    } else if (score >= 30) {
      severity = 'medium';
      level = 2;
    } else {
      severity = 'low';
      level = 1;
    }

    return {
      score: Math.min(100, score),
      severity,
      level,
      description: this.getSeverityDescription(severity)
    };
  }

  assessCascadeRisk(serviceName, affectedDownstream) {
    const directDependents = this.getDirectDependents(serviceName);
    
    const vulnerableDependents = directDependents.filter(d => {
      const health = this.health.services[d.service];
      return health?.instanceCount === 1 || health?.healthStatus !== 'healthy';
    });

    const cascadeLevels = this.estimateCascadeLevels(serviceName);

    return {
      riskLevel: vulnerableDependents.length > 0 ? 'high' : 'medium',
      vulnerableServices: vulnerableDependents.map(v => v.service),
      estimatedCascadeLevels: cascadeLevels,
      hasSinglePointOfFailure: directDependents.some(d => {
        const health = this.health.services[d.service];
        return health?.instanceCount === 1;
      })
    };
  }

  generateRecoveryRecommendations(serviceName, failureSeverity) {
    const recommendations = [];
    const serviceHealth = this.health.services[serviceName];

    recommendations.push({
      priority: 'immediate',
      action: `立即启动 ${serviceName} 的故障排查流程`,
      reason: failureSeverity.severity === 'critical' 
        ? '该服务故障会导致严重的级联影响'
        : '需要尽快恢复服务以减少影响范围'
    });

    if (serviceHealth?.instanceCount === 1) {
      recommendations.push({
        priority: 'high',
        action: `紧急扩容 ${serviceName}，增加冗余实例`,
        reason: '当前为单实例部署，存在单点故障风险'
      });
    }

    const directDependents = this.getDirectDependents(serviceName);
    directDependents.slice(0, 3).forEach(d => {
      if (d.requestCount > 10000) {
        recommendations.push({
          priority: 'high',
          action: `为 ${d.service} 配置降级策略，减少对 ${serviceName} 的依赖`,
          reason: `该服务每秒向故障服务发送 ${d.requestCount.toLocaleString()} 个请求`
        });
      }
    });

    const criticalImpact = this.getCriticalPathImpact(serviceName);
    if (criticalImpact.isInCriticalPath) {
      recommendations.push({
        priority: 'critical',
        action: '启动关键路径应急预案',
        reason: `故障服务位于关键路径第 ${criticalImpact.position} 位，影响 ${criticalImpact.downstreamServicesOnCriticalPath.length} 个下游服务`
      });
    }

    recommendations.push({
      priority: 'medium',
      action: `监控 ${serviceName} 的下游服务状态，防止级联故障`,
      reason: `预计影响 ${this.getAffectedDownstream(serviceName).length} 个下游服务`
    });

    recommendations.push({
      priority: 'low',
      action: '事后分析：完善熔断、限流等容错机制',
      reason: '避免类似故障导致更大范围的影响'
    });

    return recommendations.sort((a, b) => {
      const priorityOrder = { critical: 0, immediate: 1, high: 2, medium: 3, low: 4 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  formatSimulationResult(result) {
    if (!result.success) {
      return chalk.red(`❌ 模拟失败: ${result.error}`);
    }

    const output = [];
    const severityColors = {
      critical: chalk.red.bold,
      high: chalk.red,
      medium: chalk.yellow,
      low: chalk.green
    };

    output.push('');
    output.push(chalk.bold.white('═'.repeat(60)));
    output.push(chalk.bold.white(`  🚨 故障模拟分析报告: ${result.failedService}`));
    output.push(chalk.bold.white('═'.repeat(60)));
    output.push('');

    const severityText = severityColors[result.failureSeverity.severity](
      result.failureSeverity.severity.toUpperCase()
    );
    output.push(`  故障严重程度: ${severityText} (${result.failureSeverity.score}/100)`);
    output.push(`  ${result.failureSeverity.description}`);
    output.push('');

    output.push(chalk.bold.white('【影响范围汇总】'));
    output.push(`  总影响服务数: ${chalk.red(result.impactSummary.totalAffectedServices)}`);
    output.push(`  直接依赖服务: ${chalk.yellow(result.impactSummary.directlyAffected)}`);
    output.push(`  间接影响服务: ${chalk.yellow(result.impactSummary.indirectlyAffected)}`);
    output.push(`  影响流量占比: ${chalk.red(result.impactSummary.trafficImpact.percentageOfTotalTraffic)}%`);
    
    if (result.impactSummary.criticalPathImpact.isInCriticalPath) {
      output.push(`  ${chalk.red.bold('⚠️  该服务位于关键路径上!')}`);
      output.push(`     位置: 第 ${result.impactSummary.criticalPathImpact.position}/${result.impactSummary.criticalPathImpact.totalPathLength} 位`);
      output.push(`     影响下游关键服务: ${result.impactSummary.criticalPathImpact.downstreamServicesOnCriticalPath.join(', ')}`);
    }
    output.push('');

    if (result.directDependents.length > 0) {
      output.push(chalk.bold.white('【直接调用方（将立即受影响）】'));
      result.directDependents.slice(0, 5).forEach((d, i) => {
        const statusColor = d.healthStatus === 'healthy' ? chalk.green : 
                           d.healthStatus === 'degraded' ? chalk.yellow : chalk.red;
        output.push(`  ${i + 1}. ${d.service} ${statusColor(`[${d.healthStatus}]`)}`);
        output.push(`     请求量: ${d.requestCount.toLocaleString()}/s, 平均延迟: ${d.avgLatency}ms`);
      });
      if (result.directDependents.length > 5) {
        output.push(`  ... 还有 ${result.directDependents.length - 5} 个调用方`);
      }
      output.push('');
    }

    if (result.affectedDownstream.length > 0) {
      output.push(chalk.bold.white('【下游影响链】'));
      output.push(chalk.gray(`  (按影响深度排序，★ 表示高风险)`));
      result.affectedDownstream.slice(0, 10).forEach((a, i) => {
        const impactIcon = a.impactLevel === 'high' ? '★' : '☆';
        const impactColor = a.impactLevel === 'high' ? chalk.red : chalk.yellow;
        const statusColor = a.healthStatus === 'healthy' ? chalk.green : 
                           a.healthStatus === 'degraded' ? chalk.yellow : chalk.red;
        output.push(`  ${i + 1}. ${impactColor(impactIcon)} ${a.service} ${statusColor(`[${a.healthStatus}]`)}`);
        output.push(`     深度: ${a.depth}, 路径: ${a.path.join(' → ')}`);
      });
      if (result.affectedDownstream.length > 10) {
        output.push(`  ... 还有 ${result.affectedDownstream.length - 10} 个受影响服务`);
      }
      output.push('');
    }

    output.push(chalk.bold.white('【级联故障风险评估】'));
    const cascadeRiskColor = result.cascadeRisk.riskLevel === 'high' ? chalk.red : chalk.yellow;
    output.push(`  风险等级: ${cascadeRiskColor(result.cascadeRisk.riskLevel.toUpperCase())}`);
    output.push(`  预计级联深度: ${result.cascadeRisk.estimatedCascadeLevels} 层`);
    if (result.cascadeRisk.vulnerableServices.length > 0) {
      output.push(`  易受攻击服务: ${chalk.red(result.cascadeRisk.vulnerableServices.join(', '))}`);
    }
    if (result.cascadeRisk.hasSinglePointOfFailure) {
      output.push(`  ${chalk.red.bold('⚠️  存在单点故障风险!')}`);
    }
    output.push('');

    output.push(chalk.bold.white('【恢复建议】'));
    result.recoveryRecommendations.forEach((rec, i) => {
      const priorityColors = {
        critical: chalk.red.bold,
        immediate: chalk.red,
        high: chalk.yellow,
        medium: chalk.blue,
        low: chalk.gray
      };
      const priorityText = priorityColors[rec.priority](`[${rec.priority.toUpperCase()}]`);
      output.push(`  ${i + 1}. ${priorityText} ${rec.action}`);
      output.push(`     ${chalk.gray(rec.reason)}`);
    });

    output.push('');
    return output.join('\n');
  }

  calculateImpactLevel(depth) {
    if (depth <= 1) return 'high';
    if (depth <= 3) return 'medium';
    return 'low';
  }

  calculateFailureProbability(depth, serviceHealth) {
    let probability = 100 / (depth + 1);
    
    if (serviceHealth) {
      if (serviceHealth.healthStatus === 'unhealthy') probability += 20;
      else if (serviceHealth.healthStatus === 'degraded') probability += 10;
      if (serviceHealth.instanceCount === 1) probability += 15;
    }
    
    return Math.min(100, probability);
  }

  calculateDirectImpact(caller) {
    let impact = 0;
    if (caller.requestCount > 50000) impact += 30;
    else if (caller.requestCount > 10000) impact += 20;
    else if (caller.requestCount > 1000) impact += 10;
    
    if (caller.errorRate > 5) impact += 20;
    else if (caller.errorRate > 2) impact += 10;
    
    if (caller.avgLatency > 200) impact += 20;
    else if (caller.avgLatency > 100) impact += 10;
    
    return Math.min(100, impact);
  }

  countCallsTo(fromService, toService) {
    const { adjacencyList } = this.dependencies;
    const calls = adjacencyList[fromService] || [];
    const call = calls.find(c => c.service === toService);
    return call ? call.requestCount : 0;
  }

  estimateCascadeLevels(serviceName) {
    const affected = this.getAffectedDownstream(serviceName);
    if (affected.length === 0) return 0;
    return Math.max(...affected.map(a => a.depth));
  }

  getSeverityDescription(severity) {
    const descriptions = {
      critical: '该服务故障将导致严重的业务中断，需要立即响应处理',
      high: '该服务故障将导致较大范围的影响，需要紧急处理',
      medium: '该服务故障将导致局部功能不可用，建议尽快处理',
      low: '该服务故障影响范围有限，可按常规流程处理'
    };
    return descriptions[severity] || '未知严重程度';
  }
}

module.exports = FailureSimulator;
