const chalk = require('chalk');
const MicroserviceTopology = require('../src/index');
const FailureSimulator = require('../src/simulators/failure');
const HistoryStorage = require('../src/storages/history');
const DriftAnalyzer = require('../src/analyzers/drift');
const EmailNotifier = require('../src/notifiers/email');
const SlackNotifier = require('../src/notifiers/slack');
const CronScheduler = require('../src/schedulers/cron');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(chalk.green(`  ✓ ${name}`));
    passed++;
  } catch (error) {
    console.log(chalk.red(`  ✗ ${name}`));
    console.log(chalk.red(`    ${error.message}`));
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

async function runTests() {
  console.log(chalk.cyan.bold('\n🧪 运行微服务拓扑诊断工具测试\n'));

  console.log(chalk.bold('1. 基础连接测试'));
  
  const topology = new MicroserviceTopology();
  await topology.connect('mock');
  
  test('能够连接到Mock数据源', () => {
    assert(topology.adapter && topology.adapter.isConnected(), '适配器未连接');
  });

  console.log('\n' + chalk.bold('2. 数据收集测试'));
  
  const data = await topology.collect();
  test('能够收集服务数据', () => {
    assert(data && data.services && data.calls, '数据结构不完整');
    assert(data.services.length > 0, '未收集到服务数据');
    assert(data.calls.length > 0, '未收集到调用关系数据');
  });

  test('服务数据包含必要字段', () => {
    const service = data.services[0];
    assert(service.name, '缺少name字段');
    assert(service.status, '缺少status字段');
    assert(typeof service.instanceCount === 'number', '缺少instanceCount字段');
    assert(typeof service.cpuUsage === 'number', '缺少cpuUsage字段');
    assert(typeof service.memoryUsage === 'number', '缺少memoryUsage字段');
  });

  test('调用关系数据包含必要字段', () => {
    const call = data.calls[0];
    assert(call.from, '缺少from字段');
    assert(call.to, '缺少to字段');
    assert(typeof call.avgLatency === 'number', '缺少avgLatency字段');
    assert(typeof call.errorRate === 'number', '缺少errorRate字段');
    assert(typeof call.requestCount === 'number', '缺少requestCount字段');
  });

  console.log('\n' + chalk.bold('3. 分析功能测试'));
  
  const analysis = topology.analyze();
  
  test('依赖分析功能正常', () => {
    assert(analysis.dependencies, '缺少dependencies分析结果');
    assert(analysis.dependencies.adjacencyList, '缺少邻接表');
    assert(analysis.dependencies.inDegree, '缺少入度计算');
    assert(analysis.dependencies.outDegree, '缺少出度计算');
    assert(analysis.dependencies.layers, '缺少分层结果');
  });

  test('健康分析功能正常', () => {
    assert(analysis.health, '缺少health分析结果');
    assert(analysis.health.summary, '缺少健康汇总');
    assert(analysis.health.services, '缺少服务健康状态');
    assert(typeof analysis.health.summary.overallScore === 'number', '缺少整体健康评分');
  });

  test('性能分析功能正常', () => {
    assert(analysis.performance, '缺少performance分析结果');
    assert(analysis.performance.serviceMetrics, '缺少服务性能指标');
    assert(analysis.performance.edgeMetrics, '缺少边性能指标');
    assert(analysis.performance.bottlenecks, '缺少瓶颈分析');
  });

  test('关键路径分析功能正常', () => {
    assert(analysis.criticalPath, '缺少criticalPath分析结果');
    assert(analysis.criticalPath.criticalPath, '缺少关键路径');
    assert(Array.isArray(analysis.criticalPath.criticalPath), '关键路径格式错误');
    assert(typeof analysis.criticalPath.totalDuration === 'number', '缺少总耗时');
  });

  console.log('\n' + chalk.bold('4. 格式化输出测试'));
  
  test('ASCII格式化正常', () => {
    const asciiOutput = topology.format('ascii', { color: false, showDetails: false });
    assert(typeof asciiOutput === 'string', 'ASCII输出不是字符串');
    assert(asciiOutput.length > 0, 'ASCII输出为空');
    assert(asciiOutput.includes('微服务依赖拓扑诊断报告'), 'ASCII输出缺少标题');
  });

  test('HTML格式化正常', () => {
    const htmlOutput = topology.format('html', { writeToFile: false });
    assert(typeof htmlOutput === 'string', 'HTML输出不是字符串');
    assert(htmlOutput.length > 0, 'HTML输出为空');
    assert(htmlOutput.includes('<!DOCTYPE html>'), 'HTML输出缺少文档声明');
    assert(htmlOutput.includes('微服务依赖拓扑诊断报告'), 'HTML输出缺少标题');
  });

  console.log('\n' + chalk.bold('5. 故障模拟测试'));
  
  const simulator = new FailureSimulator(analysis);
  const testService = data.services[0].name;
  
  test('故障模拟返回正确结构', () => {
    const result = topology.simulateFailure(testService);
    assert(result.success, '故障模拟失败');
    assert(result.failedService === testService, '故障服务名称不匹配');
    assert(result.failureSeverity, '缺少故障严重程度');
    assert(result.impactSummary, '缺少影响范围汇总');
  });

  test('能够识别下游影响', () => {
    const result = topology.simulateFailure(testService);
    assert(Array.isArray(result.affectedDownstream), '下游影响列表格式错误');
    assert(Array.isArray(result.directDependents), '直接依赖列表格式错误');
  });

  test('能够识别关键路径影响', () => {
    const result = topology.simulateFailure(testService);
    assert(result.impactSummary.criticalPathImpact, '缺少关键路径影响分析');
    assert(typeof result.impactSummary.criticalPathImpact.isInCriticalPath === 'boolean', '关键路径标识格式错误');
  });

  test('能够生成恢复建议', () => {
    const result = topology.simulateFailure(testService);
    assert(Array.isArray(result.recoveryRecommendations), '恢复建议格式错误');
    assert(result.recoveryRecommendations.length > 0, '未生成恢复建议');
    result.recoveryRecommendations.forEach(rec => {
      assert(rec.priority, '缺少优先级');
      assert(rec.action, '缺少行动建议');
      assert(rec.reason, '缺少原因说明');
    });
  });

  test('故障模拟输出格式化正常', () => {
    const result = topology.simulateFailure(testService);
    const formatted = simulator.formatSimulationResult(result);
    assert(typeof formatted === 'string', '格式化输出不是字符串');
    assert(formatted.length > 0, '格式化输出为空');
    assert(formatted.includes('故障模拟分析报告'), '输出缺少报告标题');
  });

  console.log('\n' + chalk.bold('6. 单项服务分析测试'));
  
  test('能够按服务名过滤数据', async () => {
    const topology2 = new MicroserviceTopology();
    await topology2.connect('mock');
    const filteredData = await topology2.collect('order-service');
    
    assert(filteredData.services.some(s => s.name === 'order-service'), '未找到指定服务');
    assert(filteredData.calls.some(c => c.from === 'order-service' || c.to === 'order-service'), 
           '未找到相关调用关系');
  });

  console.log('\n' + chalk.bold('7. 核心算法验证'));
  
  test('依赖图构建正确', () => {
    const adj = analysis.dependencies.adjacencyList;
    const services = Object.keys(adj);
    
    assert(services.length === data.services.length, '邻接表服务数量不匹配');
    
    data.calls.forEach(call => {
      assert(adj[call.from].some(e => e.service === call.to), 
             `调用关系 ${call.from} -> ${call.to} 未在邻接表中`);
    });
  });

  test('拓扑排序正确', () => {
    const topoOrder = analysis.dependencies.topoOrder;
    assert(Array.isArray(topoOrder), '拓扑排序结果格式错误');
    assert(topoOrder.length === data.services.length, '拓扑排序服务数量不匹配');
  });

  test('层分配正确', () => {
    const layers = analysis.dependencies.layers;
    assert(layers.grouped, '缺少分层分组');
    assert(typeof layers.maxLayer === 'number', '缺少最大层数');
    
    const allAssigned = Object.values(layers.grouped).flat();
    assert(allAssigned.length === data.services.length, '部分服务未分配层级');
  });

  test('错误率计算正确', () => {
    Object.values(analysis.performance.serviceMetrics).forEach(metric => {
      assert(typeof metric.errorRate === 'number', '错误率不是数字');
      assert(metric.errorRate >= 0, '错误率不能为负数');
    });
  });

  test('关键路径算法正确', () => {
    const cp = analysis.criticalPath.criticalPath;
    const duration = analysis.criticalPath.totalDuration;
    
    assert(cp.length > 0, '关键路径为空');
    assert(duration >= 0, '总耗时不能为负数');
    
    if (cp.length > 1) {
      let calculatedDuration = 0;
      for (let i = 0; i < cp.length - 1; i++) {
        const edge = analysis.dependencies.adjacencyList[cp[i]]?.find(e => e.service === cp[i + 1]);
        if (edge) calculatedDuration += edge.avgLatency;
      }
      assert(calculatedDuration === duration, `关键路径耗时不匹配: 计算${calculatedDuration}ms vs 实际${duration}ms`);
    }
  });

  console.log('\n' + chalk.bold('8. 边界条件测试'));
  
  test('不存在的服务故障模拟返回错误', () => {
    const result = topology.simulateFailure('non-existent-service');
    assert(result.success === false, '对不存在的服务应该返回失败');
    assert(result.error, '应该包含错误信息');
  });

  console.log('\n' + chalk.bold('9. 历史存储模块测试'));
  
  const historyStorage = new HistoryStorage();
  
  test('历史存储初始化正常', () => {
    assert(historyStorage.storageDir, '缺少存储目录');
    assert(typeof historyStorage.storageDir === 'string', '存储目录格式错误');
  });

  test('能够保存历史快照', () => {
    const result = historyStorage.saveSnapshot(analysis, 'mock');
    assert(result.timestamp, '缺少时间戳');
    assert(result.path, '缺少文件路径');
    assert(result.snapshot, '缺少快照数据');
  });

  test('能够加载历史快照', () => {
    historyStorage.saveSnapshot(analysis, 'mock');
    const snapshots = historyStorage.loadRecentSnapshots(10);
    assert(Array.isArray(snapshots), '快照列表格式错误');
    assert(snapshots.length > 0, '应该至少有一个快照');
  });

  test('能够列出所有快照', () => {
    const list = historyStorage.listSnapshots();
    assert(Array.isArray(list), '快照列表格式错误');
    assert(list.length > 0, '应该至少有一个快照');
    assert(list[0].timestamp, '缺少时间戳');
    assert(list[0].path, '缺少文件路径');
  });

  test('能够获取存储统计', () => {
    const stats = historyStorage.getStats();
    assert(typeof stats.snapshotCount === 'number', '缺少快照总数');
    assert(typeof stats.totalSizeBytes === 'number', '缺少总大小');
    assert(stats.storageDir, '缺少存储目录');
  });

  console.log('\n' + chalk.bold('10. 异常漂移检测模块测试'));
  
  test('漂移分析器初始化正常', () => {
    const driftAnalyzer = new DriftAnalyzer(historyStorage, { minSnapshotsForTrend: 3 });
    assert(driftAnalyzer.minSnapshotsForTrend === 3, '最小快照数设置错误');
    assert(driftAnalyzer.history === historyStorage, '历史存储未正确设置');
  });

  test('线性回归趋势计算正常', () => {
    const driftAnalyzer = new DriftAnalyzer(historyStorage, { minSnapshotsForTrend: 3 });
    const series = [
      { avgIncomingLatency: 100, timestamp: Date.now() - 86400000 * 2 },
      { avgIncomingLatency: 110, timestamp: Date.now() - 86400000 },
      { avgIncomingLatency: 120, timestamp: Date.now() }
    ];
    const trend = driftAnalyzer._calculateTrend(series, 'avgIncomingLatency');
    assert(trend !== null, '趋势计算应该返回结果');
    assert(typeof trend.slope === 'number', '斜率应该是数字');
    assert(typeof trend.rSquared === 'number', 'R²应该是数字');
    assert(trend.direction === 'up', '趋势方向应该是上升');
    assert(trend.slope > 0, '斜率应该为正');
    assert(trend.rSquared > 0.9, 'R²应该接近1');
  });

  test('漂移检测能够识别异常', () => {
    historyStorage.clearAll();
    const baseTime = Date.now() - 86400000 * 4;
    for (let i = 0; i < 4; i++) {
      const snapshot = {
        timestamp: baseTime + i * 86400000,
        services: {
          'test-svc': {
            avgIncomingLatency: 100 + i * 30,
            errorRate: 0.01 + i * 0.02,
            score: 95 - i * 5,
            cpuUsage: 30 + i * 10,
            memoryUsage: 40 + i * 5,
            healthStatus: i < 3 ? 'healthy' : 'degraded',
            instanceCount: 3
          }
        },
        edges: {},
        summary: {
          totalServices: 1,
          healthyCount: 1,
          degradedCount: i === 3 ? 1 : 0,
          unhealthyCount: 0,
          overallScore: 95 - i * 5,
          overallStatus: i < 3 ? 'healthy' : 'degraded',
          criticalPathDuration: 100,
          criticalPathLength: 1,
          slowEdgeCount: 0,
          highErrorEdgeCount: 0
        }
      };
      const fs = require('fs');
      const path = require('path');
      const date = new Date(snapshot.timestamp);
      const dateStr = date.toISOString().replace(/[:.]/g, '-');
      const snapshotPath = path.join(historyStorage.storageDir, `snapshot-${dateStr}.json`);
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');
    }
    
    const currentSnapshot = historyStorage.loadLatestSnapshot();
    const driftAnalyzer = new DriftAnalyzer(historyStorage, { minSnapshotsForTrend: 3 });
    const result = driftAnalyzer.detect(currentSnapshot);
    
    assert(result !== null, '漂移检测应该返回结果');
    assert(result.serviceAnomalies, '应该有服务异常列表');
    assert(result.summary, '应该有汇总信息');
    assert(typeof result.summary.totalAnomalies === 'number', '应该有异常总数');
  });

  console.log('\n' + chalk.bold('11. 通知模块测试'));
  
  test('邮件通知器初始化正常', () => {
    const emailNotifier = new EmailNotifier({
      host: 'smtp.example.com',
      port: 587,
      user: 'test@example.com',
      pass: 'password'
    });
    assert(emailNotifier.config, '缺少配置');
    assert(emailNotifier.transporter, '缺少邮件传输器');
  });

  test('邮件通知器能够构建漂移报告文本', () => {
    const emailNotifier = new EmailNotifier({ host: 'smtp.example.com', port: 587 });
    const drift = {
      severity: 'warning',
      summary: { totalAnomalies: 5, criticalAnomalies: 1, warningAnomalies: 3, infoAnomalies: 1 },
      serviceAnomalies: [
        { service: 'test-svc', maxSeverity: 'warning', anomalyCount: 2, anomalies: [{ message: '延迟上升' }] }
      ],
      trends: []
    };
    const text = emailNotifier._buildDriftText(drift, analysis);
    assert(typeof text === 'string', '文本格式错误');
    assert(text.includes('异常漂移检测报告'), '缺少报告标题');
    assert(text.includes('test-svc'), '缺少服务名称');
  });

  test('Slack通知器初始化正常', () => {
    const slackNotifier = new SlackNotifier({
      webhookUrl: 'https://hooks.slack.com/test',
      channel: '#alerts'
    });
    assert(slackNotifier.webhookUrl === 'https://hooks.slack.com/test', 'Webhook URL设置错误');
    assert(slackNotifier.channel === '#alerts', '频道设置错误');
  });

  test('Slack通知器能够构建漂移报告Blocks', () => {
    const slackNotifier = new SlackNotifier({ webhookUrl: 'https://hooks.slack.com/test' });
    const drift = {
      severity: 'warning',
      summary: { totalAnomalies: 5, criticalAnomalies: 1, warningAnomalies: 3, infoAnomalies: 1 },
      serviceAnomalies: [
        { service: 'test-svc', maxSeverity: 'warning', anomalyCount: 2, anomalies: [{ message: '延迟上升' }] }
      ],
      trends: []
    };
    const blocks = slackNotifier._buildDriftBlocks(drift, analysis);
    assert(Array.isArray(blocks), 'Blocks格式错误');
    assert(blocks.length > 0, 'Blocks不能为空');
    assert(blocks[0].type === 'header', '第一个Block应该是header');
  });

  console.log('\n' + chalk.bold('12. 定时调度模块测试'));
  
  test('调度器初始化正常', () => {
    const scheduler = new CronScheduler();
    assert(scheduler.jobs, '缺少作业映射');
    assert(typeof scheduler.jobs === 'object', '作业映射格式错误');
  });

  test('能够解析简化间隔表达式', () => {
    const scheduler = new CronScheduler();
    assert(scheduler._parseInterval('30s') === 30 * 1000, '30秒解析错误');
    assert(scheduler._parseInterval('1m') === 60 * 1000, '1分钟解析错误');
    assert(scheduler._parseInterval('5m') === 5 * 60 * 1000, '5分钟解析错误');
    assert(scheduler._parseInterval('1h') === 60 * 60 * 1000, '1小时解析错误');
    assert(scheduler._parseInterval('1d') === 24 * 60 * 60 * 1000, '1天解析错误');
    assert(scheduler._parseInterval('invalid') === null, '无效间隔应该返回null');
  });

  test('能够构建Cron表达式', () => {
    const scheduler = new CronScheduler();
    const cron = scheduler._buildCronExpression({ minute: '*/5' });
    assert(typeof cron === 'string', 'Cron表达式格式错误');
    assert(cron.includes('*/5'), 'Cron表达式应该包含*/5');
  });

  console.log('\n' + chalk.bold('13. 主类新功能集成测试'));
  
  test('主类能够保存历史快照', () => {
    topology.saveHistory('test');
    const stats = topology.getHistoryStats();
    assert(stats.snapshotCount > 0, '应该有历史快照');
  });

  test('主类能够列出历史快照', () => {
    const list = topology.listHistory();
    assert(Array.isArray(list), '历史列表格式错误');
    assert(list.length > 0, '应该至少有一个快照');
  });

  test('主类能够对比历史检测漂移', () => {
    const result = topology.compareHistory({
      minSnapshots: 2,
      driftThreshold: 0.1,
      severityThreshold: 'info'
    });
    assert(result !== null, '对比历史应该返回结果');
    assert(result.currentSnapshot, '应该包含当前快照');
    assert(result.drift, '应该包含漂移检测结果');
    assert(typeof result.reportText === 'string', '应该包含文本报告');
    assert(typeof result.reportHtml === 'string', '应该包含HTML报告');
  });

  test('主类能够列出定时任务', () => {
    const jobs = topology.listSchedules();
    assert(Array.isArray(jobs), '任务列表格式错误');
  });

  console.log('\n' + chalk.bold('═══════════════════════════════════════════════════'));
  
  if (failed === 0) {
    console.log(chalk.green.bold(`\n🎉 所有测试通过! (${passed}/${passed})`));
    console.log(chalk.green('\n项目功能完整，可以正常使用。'));
  } else {
    console.log(chalk.red.bold(`\n❌ 测试完成, ${passed} 通过, ${failed} 失败`));
  }

  console.log('\n' + chalk.cyan('使用示例:'));
  console.log('  npm install');
  console.log('  node bin/ms-topology.js analyze --source mock');
  console.log('  node bin/ms-topology.js analyze --source mock --format html');
  console.log('  node bin/ms-topology.js simulate --source mock');
  console.log('  node bin/ms-topology.js interactive --source mock');
  console.log('');

  return failed === 0;
}

runTests().catch(err => {
  console.error(chalk.red.bold(`测试执行失败: ${err.message}`));
  console.error(err.stack);
  process.exit(1);
});
