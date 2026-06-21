class HealthAnalyzer {
  constructor(data) {
    this.data = data;
  }

  analyze() {
    const healthStatus = {};
    let totalHealthy = 0;
    let totalDegraded = 0;
    let totalUnhealthy = 0;

    this.data.services.forEach(service => {
      const status = this.determineHealthStatus(service);
      healthStatus[service.name] = {
        ...service,
        healthStatus: status,
        score: this.calculateHealthScore(service),
        issues: this.detectIssues(service)
      };

      if (status === 'healthy') totalHealthy++;
      else if (status === 'degraded') totalDegraded++;
      else if (status === 'unhealthy') totalUnhealthy++;
    });

    const overallScore = this.calculateOverallHealthScore(healthStatus);
    const overallStatus = this.determineOverallStatus(overallScore);

    return {
      services: healthStatus,
      summary: {
        total: this.data.services.length,
        healthy: totalHealthy,
        degraded: totalDegraded,
        unhealthy: totalUnhealthy,
        overallScore,
        overallStatus
      },
      criticalServices: this.identifyCriticalServices(healthStatus),
      warnings: this.generateWarnings(healthStatus)
    };
  }

  determineHealthStatus(service) {
    if (service.status) {
      return service.status;
    }

    const score = this.calculateHealthScore(service);
    if (score >= 80) return 'healthy';
    if (score >= 50) return 'degraded';
    return 'unhealthy';
  }

  calculateHealthScore(service) {
    let score = 100;

    if (service.cpuUsage !== undefined) {
      if (service.cpuUsage > 90) score -= 30;
      else if (service.cpuUsage > 80) score -= 15;
      else if (service.cpuUsage > 70) score -= 5;
    }

    if (service.memoryUsage !== undefined) {
      if (service.memoryUsage > 90) score -= 30;
      else if (service.memoryUsage > 80) score -= 15;
      else if (service.memoryUsage > 70) score -= 5;
    }

    if (service.instanceCount !== undefined) {
      if (service.instanceCount === 0) score = 0;
      else if (service.instanceCount === 1) score -= 20;
    }

    if (service.status === 'unhealthy') score = Math.min(score, 30);
    else if (service.status === 'degraded') score = Math.min(score, 60);

    return Math.max(0, Math.min(100, score));
  }

  detectIssues(service) {
    const issues = [];

    if (service.cpuUsage > 80) {
      issues.push({
        severity: service.cpuUsage > 90 ? 'critical' : 'warning',
        type: 'high_cpu',
        message: `CPU使用率过高: ${service.cpuUsage}%`
      });
    }

    if (service.memoryUsage > 80) {
      issues.push({
        severity: service.memoryUsage > 90 ? 'critical' : 'warning',
        type: 'high_memory',
        message: `内存使用率过高: ${service.memoryUsage}%`
      });
    }

    if (service.instanceCount === 1) {
      issues.push({
        severity: 'warning',
        type: 'single_instance',
        message: '单实例部署，存在单点故障风险'
      });
    }

    if (service.status === 'unhealthy') {
      issues.push({
        severity: 'critical',
        type: 'unhealthy',
        message: '服务状态异常'
      });
    } else if (service.status === 'degraded') {
      issues.push({
        severity: 'warning',
        type: 'degraded',
        message: '服务性能下降'
      });
    }

    return issues;
  }

  calculateOverallHealthScore(healthStatus) {
    const scores = Object.values(healthStatus).map(s => s.score);
    if (scores.length === 0) return 100;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  determineOverallStatus(score) {
    if (score >= 80) return 'healthy';
    if (score >= 50) return 'degraded';
    return 'unhealthy';
  }

  identifyCriticalServices(healthStatus) {
    return Object.entries(healthStatus)
      .filter(([_, s]) => s.healthStatus === 'unhealthy' || s.healthStatus === 'degraded')
      .sort((a, b) => a[1].score - b[1].score)
      .map(([name, s]) => ({
        name,
        status: s.healthStatus,
        score: s.score,
        issues: s.issues
      }));
  }

  generateWarnings(healthStatus) {
    const warnings = [];
    const criticalCount = Object.values(healthStatus).filter(s => s.healthStatus === 'unhealthy').length;
    const degradedCount = Object.values(healthStatus).filter(s => s.healthStatus === 'degraded').length;

    if (criticalCount > 0) {
      warnings.push({
        severity: 'critical',
        message: `有 ${criticalCount} 个服务处于异常状态，需要立即处理`
      });
    }

    if (degradedCount > 0) {
      warnings.push({
        severity: 'warning',
        message: `有 ${degradedCount} 个服务性能下降，建议关注`
      });
    }

    const highCpuServices = Object.entries(healthStatus)
      .filter(([_, s]) => s.cpuUsage > 80)
      .map(([name]) => name);
    if (highCpuServices.length > 0) {
      warnings.push({
        severity: 'warning',
        message: `以下服务CPU使用率过高: ${highCpuServices.join(', ')}`
      });
    }

    const singleInstanceServices = Object.entries(healthStatus)
      .filter(([_, s]) => s.instanceCount === 1)
      .map(([name]) => name);
    if (singleInstanceServices.length > 0) {
      warnings.push({
        severity: 'info',
        message: `以下服务为单实例部署，建议扩容: ${singleInstanceServices.join(', ')}`
      });
    }

    return warnings;
  }
}

module.exports = HealthAnalyzer;
