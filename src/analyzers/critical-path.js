class CriticalPathAnalyzer {
  constructor(data, dependencies, performance) {
    this.data = data;
    this.dependencies = dependencies;
    this.performance = performance;
    this.adjacencyList = dependencies.adjacencyList;
  }

  findCriticalPath() {
    const serviceNames = this.data.services.map(s => s.name);
    const inDegree = { ...this.dependencies.inDegree };
    
    const entryPoints = Object.entries(inDegree)
      .filter(([_, deg]) => deg === 0)
      .map(([name]) => name);

    if (entryPoints.length === 0) {
      entryPoints.push(serviceNames[0]);
    }

    let longestPath = [];
    let longestDuration = 0;
    let criticalPathDetails = [];

    const visited = new Set();
    const path = [];
    const pathEdges = [];

    const dfs = (current, duration, depth) => {
      if (depth > serviceNames.length + 1) return;

      visited.add(current);
      path.push(current);

      const neighbors = this.adjacencyList[current] || [];
      
      if (neighbors.length === 0 || visited.size === serviceNames.length) {
        if (duration > longestDuration) {
          longestDuration = duration;
          longestPath = [...path];
          criticalPathDetails = [...pathEdges];
        }
        visited.delete(current);
        path.pop();
        return;
      }

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.service)) {
          pathEdges.push({
            from: current,
            to: neighbor.service,
            avgLatency: neighbor.avgLatency,
            p99Latency: neighbor.p99Latency,
            errorRate: neighbor.errorRate,
            requestCount: neighbor.requestCount
          });
          dfs(neighbor.service, duration + neighbor.avgLatency, depth + 1);
          pathEdges.pop();
        }
      }

      visited.delete(current);
      path.pop();
    };

    entryPoints.forEach(entry => {
      dfs(entry, 0, 0);
    });

    if (longestPath.length === 0) {
      longestPath = entryPoints.length > 0 ? [entryPoints[0]] : [serviceNames[0]];
    }

    const allPaths = this.findAllPathsWithDuration();
    const topPaths = allPaths.slice(0, 5);

    const impactAnalysis = this.calculateCriticalPathImpact(longestPath);

    return {
      criticalPath: longestPath,
      totalDuration: longestDuration,
      pathDetails: criticalPathDetails,
      topPaths,
      impactAnalysis,
      bottleneckServices: this.identifyBottleneckServices(longestPath, criticalPathDetails)
    };
  }

  findAllPathsWithDuration() {
    const serviceNames = this.data.services.map(s => s.name);
    const paths = [];
    const inDegree = { ...this.dependencies.inDegree };
    
    const entryPoints = Object.entries(inDegree)
      .filter(([_, deg]) => deg === 0)
      .map(([name]) => name);

    const visited = new Set();
    const path = [];
    const pathEdges = [];

    const dfs = (current, duration, depth) => {
      if (depth > serviceNames.length + 1) return;

      visited.add(current);
      path.push(current);

      const neighbors = this.adjacencyList[current] || [];
      
      if (neighbors.length === 0) {
        paths.push({
          path: [...path],
          duration,
          edges: [...pathEdges]
        });
      }

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.service)) {
          pathEdges.push({
            from: current,
            to: neighbor.service,
            avgLatency: neighbor.avgLatency,
            p99Latency: neighbor.p99Latency,
            errorRate: neighbor.errorRate
          });
          dfs(neighbor.service, duration + neighbor.avgLatency, depth + 1);
          pathEdges.pop();
        } else {
          paths.push({
            path: [...path, neighbor.service],
            duration: duration + neighbor.avgLatency,
            edges: [...pathEdges, {
              from: current,
              to: neighbor.service,
              avgLatency: neighbor.avgLatency,
              p99Latency: neighbor.p99Latency,
              errorRate: neighbor.errorRate
            }]
          });
        }
      }

      visited.delete(current);
      path.pop();
    };

    entryPoints.forEach(entry => {
      dfs(entry, 0, 0);
    });

    return paths.sort((a, b) => b.duration - a.duration);
  }

  calculateCriticalPathImpact(criticalPath) {
    const impact = {};

    criticalPath.forEach((service, index) => {
      const upstream = criticalPath.slice(0, index);
      const downstream = criticalPath.slice(index + 1);

      const upstreamImpact = upstream.length;
      const downstreamImpact = downstream.length;
      const totalImpact = upstreamImpact + downstreamImpact + 1;

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
        const edge = this.adjacencyList[service]?.find(e => e.service === nextService);
        if (edge) {
          if (edge.avgLatency > 100) riskScore += 10;
          if (edge.errorRate > 2) riskScore += 15;
        }
      }

      impact[service] = {
        position: index + 1,
        upstreamCount: upstreamImpact,
        downstreamCount: downstreamImpact,
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
        severity = severity === 'low' ? 'medium' : severity;
      }

      if (serviceData.cpuUsage > 80) {
        issues.push(`CPU使用率高: ${serviceData.cpuUsage}%`);
        severity = severity === 'low' ? 'medium' : severity;
      }

      if (serviceData.memoryUsage > 80) {
        issues.push(`内存使用率高: ${serviceData.memoryUsage}%`);
        severity = severity === 'low' ? 'medium' : severity;
      }

      const nextEdge = pathDetails[i];
      if (nextEdge && nextEdge.avgLatency > 100) {
        issues.push(`下游调用延迟高: ${nextEdge.avgLatency}ms`);
        severity = severity === 'low' ? 'medium' : severity;
      }

      if (nextEdge && nextEdge.errorRate > 2) {
        issues.push(`下游调用错误率高: ${nextEdge.errorRate.toFixed(2)}%`);
        severity = severity === 'low' ? 'medium' : severity;
      }

      if (issues.length > 0) {
        bottlenecks.push({
          service,
          severity,
          issues,
          position: i + 1
        });
      }
    }

    return bottlenecks.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }

  findPathBetween(from, to) {
    const paths = [];
    const visited = new Set();
    const path = [];
    const pathEdges = [];

    const dfs = (current, duration) => {
      if (current === to) {
        paths.push({
          path: [...path],
          duration,
          edges: [...pathEdges]
        });
        return;
      }

      if (visited.has(current)) return;
      visited.add(current);

      const neighbors = this.adjacencyList[current] || [];
      for (const neighbor of neighbors) {
        path.push(neighbor.service);
        pathEdges.push({
          from: current,
          to: neighbor.service,
          avgLatency: neighbor.avgLatency,
          p99Latency: neighbor.p99Latency,
          errorRate: neighbor.errorRate
        });
        dfs(neighbor.service, duration + neighbor.avgLatency);
        path.pop();
        pathEdges.pop();
      }

      visited.delete(current);
    };

    path.push(from);
    dfs(from, 0);

    return paths.sort((a, b) => a.duration - b.duration);
  }
}

module.exports = CriticalPathAnalyzer;
