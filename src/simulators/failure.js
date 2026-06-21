const chalk = require('chalk');
const ResilienceModel = require('./resilience-model');

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

    const rawDownstream = this.getAffectedDownstream(serviceName);
    const rawUpstream = this.getAffectedUpstream(serviceName);
    const directDependents = this.getDirectDependents(serviceName);
    const criticalPathImpact = this.getCriticalPathImpact(serviceName);
    const adjustedImpact = this.calculateAdjustedImpact(serviceName, rawDownstream, directDependents);
    const rawFailureSeverity = this.calculateFailureSeverity(serviceName, rawDownstream, criticalPathImpact);
    const adjustedFailureSeverity = this.calculateAdjustedFailureSeverity(rawFailureSeverity, adjustedImpact);
    const resilienceSummary = this.buildResilienceSummary(serviceName, directDependents);
    const recoveryRecommendations = this.generateRecoveryRecommendations(serviceName, adjustedFailureSeverity, adjustedImpact, resilienceSummary);

    return {
      success: true,
      failedService: serviceName,
      failureSeverity: adjustedFailureSeverity,
      rawFailureSeverity,
      impactSummary: {
        totalAffectedServices: rawDownstream.length + rawUpstream.length,
        directlyAffected: directDependents.length,
        indirectlyAffected: rawDownstream.length - directDependents.length,
        criticalPathImpact,
        trafficImpact: this.getTrafficImpact(serviceName, rawDownstream),
        adjustedImpact
      },
      affectedDownstream: rawDownstream,
      affectedUpstream: rawUpstream,
      directDependents,
      cascadeRisk: this.assessCascadeRisk(serviceName, rawDownstream, adjustedImpact),
      resilienceSummary,
      recoveryRecommendations
    };
  }

  calculateAdjustedImpact(serviceName, affectedDownstream, directDependents) {
    const adj = this.dependencies.adjacencyList;
    const revAdj = this.dependencies.reverseAdjacencyList;

    const protectedServices = [];
    const vulnerableServices = [];
    const mitigatedServices = [];

    for (const dependent of directDependents) {
      const edge = (adj[dependent.service] || []).find(e => e.service === serviceName)
        || (revAdj[serviceName] || []).find(e => e.service === dependent.service);

      const edgeData = this.findEdge(dependent.service, serviceName);
      if (!edgeData) {
        vulnerableServices.push({
          service: dependent.service,
          reason: '无容错配置',
          effectiveErrorRate: 100,
          impactReduction: 0
        });
        continue;
      }

      const model = new ResilienceModel(edgeData);
      const impactReduction = model.getImpactReduction();
      const baseErrorRate = edgeData.errorRate || 0;
      const effectiveErrorRate = model.getEffectiveErrorRate(baseErrorRate);
      const adjustedProb = model.getAdjustedFailureProbability(100 / (1 + 1));

      const info = {
        service: dependent.service,
        circuitBreaker: edgeData.circuitBreaker ? edgeData.circuitBreaker.state : null,
        retry: edgeData.retry ? `${edgeData.retry.maxRetries}次` : null,
        fallback: edgeData.fallback ? edgeData.fallback.target : null,
        effectiveErrorRate: Math.round(effectiveErrorRate * 100) / 100,
        impactReduction: Math.round(impactReduction * 100),
        degradedLatency: model.getDegradedLatency(edgeData.avgLatency),
        resilienceDesc: model.getDescription()
      };

      if (impactReduction >= 0.7) {
        protectedServices.push(info);
      } else if (impactReduction >= 0.3) {
        mitigatedServices.push(info);
      } else {
        vulnerableServices.push(info);
      }
    }

    for (const downstream of affectedDownstream) {
      if (directDependents.some(d => d.service === downstream.service)) continue;

      const edgeData = this.findEdgeToFailed(downstream.service, serviceName, downstream.path);
      if (!edgeData) continue;

      const model = new ResilienceModel(edgeData);
      const impactReduction = model.getImpactReduction();
      const adjustedProb = model.getAdjustedFailureProbability(downstream.failureProbability / 100);

      downstream.adjustedFailureProbability = Math.round(adjustedProb * 100);
      downstream.impactReduction = Math.round(impactReduction * 100);
      downstream.resilienceDesc = model.getDescription();

      if (impactReduction >= 0.7) {
        downstream.impactLevel = 'mitigated';
      }
    }

    const totalDirectCallers = directDependents.length;
    const protectedCount = protectedServices.length;
    const mitigatedCount = mitigatedServices.length;
    const vulnerableCount = vulnerableServices.length;
    const overallReduction = totalDirectCallers > 0
      ? (protectedCount * 0.8 + mitigatedCount * 0.4) / totalDirectCallers
      : 0;

    return {
      protectedServices,
      mitigatedServices,
      vulnerableServices,
      overallReduction: Math.round(overallReduction * 100),
      adjustedAffectedCount: vulnerableCount + Math.ceil(mitigatedCount * 0.5),
      summary: this.generateImpactSummary(protectedServices, mitigatedServices, vulnerableServices)
    };
  }

  findEdge(from, to) {
    const adj = this.dependencies.adjacencyList;
    const edge = (adj[from] || []).find(e => e.service === to);
    if (edge) return edge;
    const revAdj = this.dependencies.reverseAdjacencyList;
    const revEdge = (revAdj[from] || []).find(e => e.service === to);
    if (revEdge) return revEdge;
    return null;
  }

  findEdgeToFailed(service, failedService, path) {
    const adj = this.dependencies.adjacencyList;
    if (path && path.length >= 2) {
      for (let i = 0; i < path.length - 1; i++) {
        const edge = (adj[path[i]] || []).find(e => e.service === path[i + 1]);
        if (edge) return edge;
      }
    }
    return null;
  }

  calculateAdjustedFailureSeverity(rawSeverity, adjustedImpact) {
    const reduction = adjustedImpact.overallReduction / 100;
    const adjustedScore = Math.round(rawSeverity.score * (1 - reduction * 0.5));

    let severity, level;
    if (adjustedScore >= 80) {
      severity = 'critical';
      level = 4;
    } else if (adjustedScore >= 60) {
      severity = 'high';
      level = 3;
    } else if (adjustedScore >= 30) {
      severity = 'medium';
      level = 2;
    } else {
      severity = 'low';
      level = 1;
    }

    return {
      score: adjustedScore,
      severity,
      level,
      rawScore: rawSeverity.score,
      rawSeverity: rawSeverity.severity,
      adjustedByResilience: adjustedScore < rawSeverity.score,
      description: this.getSeverityDescription(severity, adjustedScore < rawSeverity.score)
    };
  }

  buildResilienceSummary(serviceName, directDependents) {
    const adj = this.dependencies.adjacencyList;
    const revAdj = this.dependencies.reverseAdjacencyList;
    const circuitBreakers = [];
    const retries = [];
    const fallbacks = [];
    const unprotected = [];

    for (const dep of directDependents) {
      const edgeData = this.findEdge(dep.service, serviceName);
      if (!edgeData) {
        unprotected.push(dep.service);
        continue;
      }

      if (edgeData.circuitBreaker) {
        circuitBreakers.push({
          from: dep.service,
          to: serviceName,
          state: edgeData.circuitBreaker.state,
          threshold: edgeData.circuitBreaker.errorThresholdPercentage
        });
      }

      if (edgeData.retry) {
        retries.push({
          from: dep.service,
          to: serviceName,
          maxRetries: edgeData.retry.maxRetries,
          backoffMs: edgeData.retry.backoffMs
        });
      }

      if (edgeData.fallback) {
        fallbacks.push({
          from: dep.service,
          to: serviceName,
          fallbackTarget: edgeData.fallback.target,
          successRate: edgeData.fallback.successRate,
          avgLatency: edgeData.fallback.avgLatency
        });
      }

      if (!edgeData.circuitBreaker && !edgeData.retry && !edgeData.fallback) {
        unprotected.push(dep.service);
      }
    }

    return {
      circuitBreakers,
      retries,
      fallbacks,
      unprotected,
      hasCircuitBreakerProtection: circuitBreakers.length > 0,
      hasRetryMechanism: retries.length > 0,
      hasFallbackStrategy: fallbacks.length > 0,
      fullyUnprotectedCallers: unprotected
    };
  }

  generateImpactSummary(protected_, mitigated, vulnerable) {
    const parts = [];
    if (protected_.length > 0) {
      parts.push(`${protected_.length}个服务受熔断/降级保护(影响降低>70%)`);
    }
    if (mitigated.length > 0) {
      parts.push(`${mitigated.length}个服务部分缓解(影响降低30-70%)`);
    }
    if (vulnerable.length > 0) {
      parts.push(`${vulnerable.length}个服务无保护(完全受影响)`);
    }
    return parts.join('；') || '无直接依赖服务';
  }

  getAffectedDownstream(serviceName) {
    const { adjacencyList } = this.dependencies;
    const visited = new Set();
    const affected = [];
    const queue = [{ service: serviceName, depth: 0, path: [serviceName] }];
    visited.add(serviceName);

    while (queue.length > 0) {
      const { service: current, depth, path } = queue.shift();
      const neighbors = adjacencyList[current] || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.service)) {
          visited.add(neighbor.service);
          const serviceHealth = this.health.services[neighbor.service];
          const servicePerf = this.performance.serviceMetrics[neighbor.service];
          affected.push({
            service: neighbor.service,
            depth: depth + 1,
            path: [...path, neighbor.service],
            impactLevel: this.calculateImpactLevel(depth + 1),
            healthStatus: serviceHealth?.healthStatus || 'unknown',
            instanceCount: serviceHealth?.instanceCount || 0,
            incomingRequests: servicePerf?.totalIncomingRequests || 0,
            failureProbability: this.calculateFailureProbability(depth + 1, serviceHealth),
            adjustedFailureProbability: null,
            impactReduction: null,
            resilienceDesc: null
          });
          queue.push({
            service: neighbor.service,
            depth: depth + 1,
            path: [...path, neighbor.service]
          });
        }
      }
    }

    return affected.sort((a, b) => a.depth - b.depth);
  }

  getAffectedUpstream(serviceName) {
    const { reverseAdjacencyList } = this.dependencies;
    const visited = new Set();
    const affected = [];
    const queue = [{ service: serviceName, depth: 0 }];
    visited.add(serviceName);

    while (queue.length > 0) {
      const { service: current, depth } = queue.shift();
      const neighbors = reverseAdjacencyList[current] || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.service)) {
          visited.add(neighbor.service);
          const serviceHealth = this.health.services[neighbor.service];
          const servicePerf = this.performance.serviceMetrics[neighbor.service];
          affected.push({
            service: neighbor.service,
            depth: depth + 1,
            impactLevel: this.calculateImpactLevel(depth + 1),
            healthStatus: serviceHealth?.healthStatus || 'unknown',
            outgoingRequests: servicePerf?.totalOutgoingRequests || 0,
            callsToFailed: this.countCallsTo(neighbor.service, serviceName)
          });
          queue.push({ service: neighbor.service, depth: depth + 1 });
        }
      }
    }

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
      return { isInCriticalPath: false, impact: 'none', affectedPaths: 0 };
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
    if (score >= 80) { severity = 'critical'; level = 4; }
    else if (score >= 60) { severity = 'high'; level = 3; }
    else if (score >= 30) { severity = 'medium'; level = 2; }
    else { severity = 'low'; level = 1; }

    return { score: Math.min(100, score), severity, level, description: this.getSeverityDescription(severity) };
  }

  assessCascadeRisk(serviceName, affectedDownstream, adjustedImpact) {
    const directDependents = this.getDirectDependents(serviceName);
    const vulnerableDependents = directDependents.filter(d => {
      const health = this.health.services[d.service];
      return health?.instanceCount === 1 || health?.healthStatus !== 'healthy';
    });

    const rawRisk = vulnerableDependents.length > 0 ? 'high' : 'medium';
    const reducedByResilience = adjustedImpact.overallReduction > 50;
    let riskLevel = rawRisk;
    if (reducedByResilience && rawRisk === 'high') riskLevel = 'medium';
    if (adjustedImpact.overallReduction > 80) riskLevel = 'low';

    return {
      riskLevel,
      rawRisk,
      reducedByResilience,
      vulnerableServices: vulnerableDependents.map(v => v.service),
      estimatedCascadeLevels: affectedDownstream.length > 0 ? Math.max(...affectedDownstream.map(a => a.depth)) : 0,
      hasSinglePointOfFailure: directDependents.some(d => {
        const health = this.health.services[d.service];
        return health?.instanceCount === 1;
      })
    };
  }

  generateRecoveryRecommendations(serviceName, failureSeverity, adjustedImpact, resilienceSummary) {
    const recommendations = [];

    recommendations.push({
      priority: 'immediate',
      action: `立即启动 ${serviceName} 的故障排查流程`,
      reason: failureSeverity.severity === 'critical'
        ? '该服务故障会导致严重的级联影响'
        : '需要尽快恢复服务以减少影响范围'
    });

    if (resilienceSummary.unprotected.length > 0) {
      recommendations.push({
        priority: 'high',
        action: `为 ${resilienceSummary.unprotected.join(', ')} 添加熔断器和降级策略`,
        reason: `${resilienceSummary.unprotected.length}个调用方无任何容错保护，故障会直接影响这些服务`
      });
    }

    if (resilienceSummary.fallbacks.length > 0) {
      resilienceSummary.fallbacks.forEach(fb => {
        recommendations.push({
          priority: 'medium',
          action: `确认 ${fb.from} → ${fb.fallbackTarget} 降级路径可用`,
          reason: `当前降级成功率为 ${Math.round(fb.successRate * 100)}%，需要确保降级目标服务健康`
        });
      });
    }

    if (resilienceSummary.circuitBreakers.length > 0) {
      const openCBs = resilienceSummary.circuitBreakers.filter(cb => cb.state === 'open');
      const halfOpenCBs = resilienceSummary.circuitBreakers.filter(cb => cb.state === 'half-open');
      if (openCBs.length > 0) {
        recommendations.push({
          priority: 'medium',
          action: `监控已开启的熔断器: ${openCBs.map(cb => cb.from).join(', ')}`,
          reason: `${openCBs.length}个熔断器已打开，相关服务已熔断降级`
        });
      }
      if (halfOpenCBs.length > 0) {
        recommendations.push({
          priority: 'medium',
          action: `谨慎放行半开熔断器探测请求: ${halfOpenCBs.map(cb => cb.from).join(', ')}`,
          reason: `${halfOpenCBs.length}个熔断器处于半开状态，正在探测恢复`
        });
      }
    }

    const serviceHealth = this.health.services[serviceName];
    if (serviceHealth?.instanceCount === 1) {
      recommendations.push({
        priority: 'high',
        action: `紧急扩容 ${serviceName}，增加冗余实例`,
        reason: '当前为单实例部署，存在单点故障风险'
      });
    }

    const criticalImpact = this.getCriticalPathImpact(serviceName);
    if (criticalImpact.isInCriticalPath) {
      recommendations.push({
        priority: 'critical',
        action: '启动关键路径应急预案',
        reason: `故障服务位于关键路径第 ${criticalImpact.position} 位，影响 ${criticalImpact.downstreamServicesOnCriticalPath.length} 个下游服务`
      });
    }

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
    if (result.failureSeverity.adjustedByResilience) {
      output.push(`  ${chalk.green('⚡ 容错机制降低影响:')} 原始评分 ${result.rawFailureSeverity.score} → 调整后 ${result.failureSeverity.score}`);
    }
    output.push(`  ${result.failureSeverity.description}`);
    output.push('');

    output.push(chalk.bold.white('【影响范围汇总】'));
    output.push(`  原始影响服务数: ${chalk.red(result.impactSummary.totalAffectedServices)}`);
    output.push(`  考虑容错后影响: ${chalk.yellow(result.impactSummary.adjustedImpact.adjustedAffectedCount)} (降低 ${result.impactSummary.adjustedImpact.overallReduction}%)`);
    output.push(`  直接依赖服务: ${chalk.yellow(result.impactSummary.directlyAffected)}`);
    output.push(`  间接影响服务: ${chalk.yellow(result.impactSummary.indirectlyAffected)}`);
    output.push(`  影响流量占比: ${chalk.red(result.impactSummary.trafficImpact.percentageOfTotalTraffic)}%`);

    if (result.impactSummary.criticalPathImpact.isInCriticalPath) {
      output.push(`  ${chalk.red.bold('⚠️  该服务位于关键路径上!')}`);
      output.push(`     位置: 第 ${result.impactSummary.criticalPathImpact.position}/${result.impactSummary.criticalPathImpact.totalPathLength} 位`);
    }
    output.push('');

    const ai = result.impactSummary.adjustedImpact;
    if (ai.protectedServices.length > 0) {
      output.push(chalk.bold.green('【受容错保护的服务 (影响降低>70%)】'));
      ai.protectedServices.forEach((s, i) => {
        output.push(`  ${i + 1}. ${chalk.green(s.service)} - ${s.resilienceDesc}`);
        output.push(`     影响降低: ${s.impactReduction}%, 降级延迟: ${s.degradedLatency}ms`);
      });
      output.push('');
    }

    if (ai.mitigatedServices.length > 0) {
      output.push(chalk.bold.yellow('【部分缓解的服务 (影响降低30-70%)】'));
      ai.mitigatedServices.forEach((s, i) => {
        output.push(`  ${i + 1}. ${chalk.yellow(s.service)} - ${s.resilienceDesc}`);
        output.push(`     影响降低: ${s.impactReduction}%, 有效错误率: ${s.effectiveErrorRate}%`);
      });
      output.push('');
    }

    if (ai.vulnerableServices.length > 0) {
      output.push(chalk.bold.red('【无保护的服务 (完全受影响)】'));
      ai.vulnerableServices.forEach((s, i) => {
        const reason = s.reason || s.resilienceDesc || '无容错机制';
        output.push(`  ${i + 1}. ${chalk.red(s.service)} - ${reason}`);
        if (s.effectiveErrorRate !== undefined) {
          output.push(`     有效错误率: ${s.effectiveErrorRate}%`);
        }
      });
      output.push('');
    }

    const rs = result.resilienceSummary;
    if (rs.circuitBreakers.length > 0 || rs.retries.length > 0 || rs.fallbacks.length > 0) {
      output.push(chalk.bold.white('【容错机制状态】'));
      if (rs.circuitBreakers.length > 0) {
        output.push(chalk.cyan('  熔断器:'));
        rs.circuitBreakers.forEach(cb => {
          const stateColor = cb.state === 'open' ? chalk.red : cb.state === 'half-open' ? chalk.yellow : chalk.green;
          output.push(`    ${cb.from} → ${cb.to}: ${stateColor(cb.state.toUpperCase())} (阈值: ${cb.threshold}%)`);
        });
      }
      if (rs.retries.length > 0) {
        output.push(chalk.cyan('  重试策略:'));
        rs.retries.forEach(r => {
          output.push(`    ${r.from} → ${r.to}: ${r.maxRetries}次, 退避${r.backoffMs}ms`);
        });
      }
      if (rs.fallbacks.length > 0) {
        output.push(chalk.cyan('  降级策略:'));
        rs.fallbacks.forEach(f => {
          output.push(`    ${f.from} → ${f.fallbackTarget} (成功率${Math.round(f.successRate * 100)}%, 延迟${f.avgLatency}ms)`);
        });
      }
      output.push('');
    }

    output.push(chalk.bold.white('【级联故障风险评估】'));
    const cascadeRiskColor = result.cascadeRisk.riskLevel === 'high' ? chalk.red :
      result.cascadeRisk.riskLevel === 'medium' ? chalk.yellow : chalk.green;
    output.push(`  风险等级: ${cascadeRiskColor(result.cascadeRisk.riskLevel.toUpperCase())}`);
    if (result.cascadeRisk.reducedByResilience) {
      output.push(`  ${chalk.green('⚡ 容错机制已降低级联风险')} (原始: ${result.cascadeRisk.rawRisk})`);
    }
    output.push(`  预计级联深度: ${result.cascadeRisk.estimatedCascadeLevels} 层`);
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

  getSeverityDescription(severity, adjusted) {
    const base = {
      critical: '该服务故障将导致严重的业务中断，需要立即响应处理',
      high: '该服务故障将导致较大范围的影响，需要紧急处理',
      medium: '该服务故障将导致局部功能不可用，建议尽快处理',
      low: '该服务故障影响范围有限，可按常规流程处理'
    };
    let desc = base[severity] || '未知严重程度';
    if (adjusted) {
      desc += '（容错机制已降低部分影响）';
    }
    return desc;
  }
}

module.exports = FailureSimulator;
