class CriticalPathAnalyzer {
  constructor(data, dependencies, performance) {
    this.data = data;
    this.dependencies = dependencies;
    this.performance = performance;
    this.adjacencyList = dependencies.adjacencyList;
  }

  findCriticalPath() {
    const topoOrder = this.dependencies.topoOrder;
    const serviceNames = this.data.services.map(s => s.name);

    const dist = {};
    const prev = {};
    serviceNames.forEach(s => { dist[s] = 0; prev[s] = null; });

    for (const u of topoOrder) {
      for (const edge of (this.adjacencyList[u] || [])) {
        const v = edge.service;
        if (dist[u] + edge.avgLatency > dist[v]) {
          dist[v] = dist[u] + edge.avgLatency;
          prev[v] = u;
        }
      }
    }

    let endService = null;
    let maxDist = 0;
    for (const [s, d] of Object.entries(dist)) {
      if (d > maxDist) {
        maxDist = d;
        endService = s;
      }
    }

    const criticalPath = [];
    let cur = endService;
    const visited = new Set();
    while (cur !== null && !visited.has(cur)) {
      visited.add(cur);
      criticalPath.unshift(cur);
      cur = prev[cur];
    }

    if (criticalPath.length === 0) {
      criticalPath.push(serviceNames[0]);
    }

    const pathDetails = [];
    for (let i = 0; i < criticalPath.length - 1; i++) {
      const edge = (this.adjacencyList[criticalPath[i]] || [])
        .find(e => e.service === criticalPath[i + 1]);
      if (edge) {
        pathDetails.push({
          from: criticalPath[i],
          to: criticalPath[i + 1],
          avgLatency: edge.avgLatency,
          p99Latency: edge.p99Latency,
          errorRate: edge.errorRate,
          requestCount: edge.requestCount
        });
      }
    }

    const topPaths = this.findTopPathsDP(topoOrder, dist);
    const impactAnalysis = this.calculateCriticalPathImpact(criticalPath);

    return {
      criticalPath,
      totalDuration: maxDist,
      pathDetails,
      topPaths,
      impactAnalysis,
      bottleneckServices: this.identifyBottleneckServices(criticalPath, pathDetails)
    };
  }

  findTopPathsDP(topoOrder, dist) {
    const paths = [];
    const inDegree = { ...this.dependencies.inDegree };
    const terminalServices = topoOrder.filter(s => {
      return (this.adjacencyList[s] || []).length === 0;
    });

    for (const terminal of terminalServices.slice(0, 5)) {
      const path = this.backtrackPath(terminal);
      if (path.length > 0) {
        let duration = 0;
        const edges = [];
        for (let i = 0; i < path.length - 1; i++) {
          const edge = (this.adjacencyList[path[i]] || [])
            .find(e => e.service === path[i + 1]);
          if (edge) {
            duration += edge.avgLatency;
            edges.push({
              from: path[i],
              to: path[i + 1],
              avgLatency: edge.avgLatency,
              p99Latency: edge.p99Latency,
              errorRate: edge.errorRate
            });
          }
        }
        paths.push({ path, duration, edges });
      }
    }

    return paths.sort((a, b) => b.duration - a.duration).slice(0, 5);
  }

  backtrackPath(endService) {
    const path = [endService];
    const revAdj = this.dependencies.reverseAdjacencyList;
    let current = endService;
    const visited = new Set([current]);

    while (true) {
      const callers = (revAdj[current] || [])
        .filter(c => !visited.has(c.service))
        .sort((a, b) => b.avgLatency - a.avgLatency);

      if (callers.length === 0) break;
      const best = callers[0];
      path.unshift(best.service);
      visited.add(best.service);
      current = best.service;
    }
    return path;
  }

  calculateCriticalPathImpact(criticalPath) {
    const impact = {};
    criticalPath.forEach((service, index) => {
      const upstream = criticalPath.slice(0, index);
      const downstream = criticalPath.slice(index + 1);
      const totalImpact = upstream.length + downstream.length + 1;

      let riskScore = 0;
      const serviceData = this.data.services.find(s => s.name === service);
      if (serviceData) {
        if (serviceData.status === 'unhealthy') riskScore += 50;
        else if (serviceData.status === 'degraded') riskScore += 25;
        if (serviceData.instanceCount === 1) riskScore += 25;
        if (serviceData.cpuUsage > 80) riskScore += 15;
        if (serviceData.memoryUsage > 80) riskScore += 15;
      }

      const nextService = criticalPath[index + 1];
      if (nextService) {
        const edge = (this.adjacencyList[service] || []).find(e => e.service === nextService);
        if (edge) {
          if (edge.avgLatency > 100) riskScore += 10;
          if (edge.errorRate > 2) riskScore += 15;
        }
      }

      impact[service] = {
        position: index + 1,
        upstreamCount: upstream.length,
        downstreamCount: downstream.length,
        totalImpact,
        riskScore: Math.min(100, riskScore),
        criticality: totalImpact / criticalPath.length
      };
    });
    return impact;
  }

  identifyBottleneckServices(criticalPath, pathDetails) {
    const bottlenecks = [];
    for (let i = 0; i < criticalPath.length; i++) {
      const service = criticalPath[i];
      const serviceData = this.data.services.find(s => s.name === service);
      if (!serviceData) continue;

      const issues = [];
      let severity = 'low';

      if (serviceData.status === 'unhealthy') {
        issues.push('服务异常');
        severity = 'critical';
      } else if (serviceData.status === 'degraded') {
        issues.push('服务性能下降');
        severity = 'high';
      }
      if (serviceData.instanceCount === 1) {
        issues.push('单实例部署');
        if (severity === 'low') severity = 'medium';
      }
      if (serviceData.cpuUsage > 80) {
        issues.push(`CPU使用率高: ${serviceData.cpuUsage}%`);
        if (severity === 'low') severity = 'medium';
      }
      if (serviceData.memoryUsage > 80) {
        issues.push(`内存使用率高: ${serviceData.memoryUsage}%`);
        if (severity === 'low') severity = 'medium';
      }

      const nextEdge = pathDetails[i];
      if (nextEdge && nextEdge.avgLatency > 100) {
        issues.push(`下游调用延迟高: ${nextEdge.avgLatency}ms`);
        if (severity === 'low') severity = 'medium';
      }
      if (nextEdge && nextEdge.errorRate > 2) {
        issues.push(`下游调用错误率高: ${nextEdge.errorRate.toFixed(2)}%`);
        if (severity === 'low') severity = 'medium';
      }

      if (issues.length > 0) {
        bottlenecks.push({ service, severity, issues, position: i + 1 });
      }
    }

    return bottlenecks.sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return order[a.severity] - order[b.severity];
    });
  }
}

module.exports = CriticalPathAnalyzer;
