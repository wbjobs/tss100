#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const MicroserviceTopology = require('../src/index');
const FailureSimulator = require('../src/simulators/failure');

const program = new Command();

program
  .name('ms-topology')
  .description('微服务依赖拓扑交互式诊断CLI工具')
  .version('1.0.0');

program
  .command('analyze')
  .description('分析微服务依赖拓扑')
  .option('-s, --source <type>', '数据源类型: mock|consul|eureka|docker-compose|k8s', 'mock')
  .option('-svc, --service <name>', '指定要分析的服务名')
  .option('-f, --format <type>', '输出格式: ascii|html|both', 'ascii')
  .option('-o, --output <path>', 'HTML报告输出路径', 'topology-report.html')
  .option('--host <host>', '服务注册中心主机地址', 'localhost')
  .option('--port <port>', '服务注册中心端口', type => parseInt(type))
  .option('--no-color', '禁用彩色输出')
  .option('--no-details', '不显示详细信息')
  .action(async (options) => {
    try {
      console.log(chalk.cyan.bold('🔍 正在分析微服务依赖拓扑...\n'));

      const config = buildAdapterConfig(options);

      const topology = new MicroserviceTopology();
      
      await showProgress('连接数据源', async () => {
        await topology.connect(options.source, config);
      });

      await showProgress('收集服务数据', async () => {
        await topology.collect(options.service);
      });

      await showProgress('分析依赖关系', async () => {
        topology.analyze();
      });

      const analysis = topology.getAnalysis();

      if (options.format === 'ascii' || options.format === 'both') {
        const asciiOutput = topology.format('ascii', {
          color: options.color !== false,
          showDetails: options.details !== false
        });
        console.log(asciiOutput);
      }

      if (options.format === 'html' || options.format === 'both') {
        const htmlOutput = topology.format('html', {
          outputPath: options.output
        });
        console.log(chalk.green.bold(`\n📄 ${htmlOutput}`));
      }

      await askForSimulation(topology);

    } catch (error) {
      console.error(chalk.red.bold(`❌ 分析失败: ${error.message}`));
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program
  .command('simulate')
  .description('模拟服务故障，预测影响范围（假设分析）')
  .option('-s, --source <type>', '数据源类型: mock|consul|eureka|docker-compose|k8s', 'mock')
  .option('--host <host>', '服务注册中心主机地址', 'localhost')
  .option('--port <port>', '服务注册中心端口', type => parseInt(type))
  .option('--no-color', '禁用彩色输出')
  .action(async (options) => {
    try {
      console.log(chalk.cyan.bold('🚨 故障模拟模式\n'));

      const config = buildAdapterConfig(options);
      const topology = new MicroserviceTopology();

      await showProgress('连接数据源', async () => {
        await topology.connect(options.source, config);
      });

      await showProgress('收集服务数据', async () => {
        await topology.collect();
      });

      await showProgress('分析依赖关系', async () => {
        topology.analyze();
      });

      const analysis = topology.getAnalysis();
      const serviceNames = analysis.services.map(s => s.name);

      const answers = await inquirer.prompt([
        {
          type: 'list',
          name: 'failedService',
          message: '请选择要模拟故障的服务:',
          choices: serviceNames,
          pageSize: 15
        }
      ]);

      console.log(chalk.yellow(`\n正在模拟 ${answers.failedService} 故障...\n`));

      const simulator = new FailureSimulator(analysis);
      const result = topology.simulateFailure(answers.failedService);
      const formattedResult = simulator.formatSimulationResult(result);
      
      console.log(formattedResult);

      const { continueSimulation } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continueSimulation',
          message: '是否要模拟其他服务的故障?',
          default: false
        }
      ]);

      if (continueSimulation) {
        await runInteractiveSimulation(simulator, serviceNames);
      }

    } catch (error) {
      console.error(chalk.red.bold(`❌ 模拟失败: ${error.message}`));
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program
  .command('interactive')
  .description('进入交互式诊断模式')
  .option('-s, --source <type>', '数据源类型: mock|consul|eureka|docker-compose|k8s', 'mock')
  .option('--host <host>', '服务注册中心主机地址', 'localhost')
  .option('--port <port>', '服务注册中心端口', type => parseInt(type))
  .option('--no-color', '禁用彩色输出')
  .action(async (options) => {
    try {
      console.log(chalk.cyan.bold('🎯 交互式微服务诊断模式\n'));

      const config = buildAdapterConfig(options);
      const topology = new MicroserviceTopology();

      await showProgress('连接数据源', async () => {
        await topology.connect(options.source, config);
      });

      await showProgress('收集服务数据', async () => {
        await topology.collect();
      });

      await showProgress('分析依赖关系', async () => {
        topology.analyze();
      });

      await runInteractiveMode(topology, options);

    } catch (error) {
      console.error(chalk.red.bold(`❌ 操作失败: ${error.message}`));
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program
  .command('list-services')
  .description('列出所有服务')
  .option('-s, --source <type>', '数据源类型: mock|consul|eureka|docker-compose|k8s', 'mock')
  .option('--host <host>', '服务注册中心主机地址', 'localhost')
  .option('--port <port>', '服务注册中心端口', type => parseInt(type))
  .action(async (options) => {
    try {
      const config = buildAdapterConfig(options);
      const topology = new MicroserviceTopology();

      await topology.connect(options.source, config);
      const data = await topology.collect();

      console.log(chalk.cyan.bold(`\n📋 服务列表 (共 ${data.services.length} 个服务)\n`));
      
      data.services.forEach((service, index) => {
        let statusSymbol = '●';
        let statusColor = chalk.green;
        
        if (service.status === 'degraded') {
          statusSymbol = '◐';
          statusColor = chalk.yellow;
        } else if (service.status === 'unhealthy') {
          statusSymbol = '✗';
          statusColor = chalk.red;
        }

        console.log(`${index + 1}. ${statusColor(statusSymbol + ' ' + service.name)}`);
        console.log(`   状态: ${service.status} | 实例: ${service.instanceCount} | 版本: ${service.version}`);
        console.log(`   CPU: ${service.cpuUsage}% | 内存: ${service.memoryUsage}% | 运行时间: ${service.uptime}\n`);
      });

    } catch (error) {
      console.error(chalk.red.bold(`❌ 获取服务列表失败: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('critical-path')
  .description('显示关键路径分析')
  .option('-s, --source <type>', '数据源类型: mock|consul|eureka|docker-compose|k8s', 'mock')
  .option('--host <host>', '服务注册中心主机地址', 'localhost')
  .option('--port <port>', '服务注册中心端口', type => parseInt(type))
  .option('--no-color', '禁用彩色输出')
  .action(async (options) => {
    try {
      const config = buildAdapterConfig(options);
      const topology = new MicroserviceTopology();

      await topology.connect(options.source, config);
      await topology.collect();
      topology.analyze();

      const analysis = topology.getAnalysis();
      const { criticalPath, totalDuration, bottleneckServices } = analysis.criticalPath;

      console.log(chalk.cyan.bold('\n⚡ 关键路径分析\n'));
      console.log(chalk.gray(`总耗时: ${totalDuration}ms | 路径长度: ${criticalPath.length} 个服务\n`));

      let pathStr = '';
      criticalPath.forEach((service, index) => {
        const health = analysis.health.services[service];
        let serviceText = service;
        
        if (options.color !== false) {
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
          pathStr += options.color !== false ? chalk.cyan(' → ') : ' → ';
        }
      });

      console.log(`  ${pathStr}\n`);

      if (bottleneckServices.length > 0) {
        console.log(chalk.red.bold('关键路径上的瓶颈服务:\n'));
        bottleneckServices.forEach(b => {
          let severity = b.severity.toUpperCase();
          if (options.color !== false) {
            if (b.severity === 'critical') severity = chalk.red.bold(severity);
            else if (b.severity === 'high') severity = chalk.red(severity);
            else if (b.severity === 'medium') severity = chalk.yellow(severity);
          }
          console.log(`  [${severity}] ${b.service}: ${b.issues.join(', ')}`);
        });
      }

    } catch (error) {
      console.error(chalk.red.bold(`❌ 关键路径分析失败: ${error.message}`));
      process.exit(1);
    }
  });

function buildAdapterConfig(options) {
  const config = {};
  if (options.host) config.host = options.host;
  if (options.port) config.port = options.port;
  return config;
}

async function showProgress(message, task) {
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIndex = 0;
  
  const spinner = setInterval(() => {
    process.stdout.write(`\r  ${spinnerFrames[frameIndex % spinnerFrames.length]} ${message}...`);
    frameIndex++;
  }, 100);

  try {
    await task();
    clearInterval(spinner);
    process.stdout.write(`\r  ${chalk.green('✓')} ${message}  \n`);
  } catch (error) {
    clearInterval(spinner);
    process.stdout.write(`\r  ${chalk.red('✗')} ${message}  \n`);
    throw error;
  }
}

async function askForSimulation(topology) {
  const { wantSimulation } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'wantSimulation',
      message: '是否要进行故障模拟分析?',
      default: false
    }
  ]);

  if (wantSimulation) {
    const analysis = topology.getAnalysis();
    const serviceNames = analysis.services.map(s => s.name);
    const simulator = new FailureSimulator(analysis);
    await runInteractiveSimulation(simulator, serviceNames);
  }
}

async function runInteractiveSimulation(simulator, serviceNames) {
  while (true) {
    const { failedService } = await inquirer.prompt([
      {
        type: 'list',
        name: 'failedService',
        message: '选择要模拟故障的服务:',
        choices: [...serviceNames, new inquirer.Separator(), '返回主菜单'],
        pageSize: 15
      }
    ]);

    if (failedService === '返回主菜单') {
      break;
    }

    console.log(chalk.yellow(`\n正在模拟 ${failedService} 故障...\n`));
    const result = simulator.simulateFailure(failedService);
    console.log(simulator.formatSimulationResult(result));

    const { continueSimulation } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'continueSimulation',
        message: '是否继续模拟其他服务故障?',
        default: true
      }
    ]);

    if (!continueSimulation) {
      break;
    }
  }
}

async function runInteractiveMode(topology, options) {
  const analysis = topology.getAnalysis();
  const simulator = new FailureSimulator(analysis);
  const serviceNames = analysis.services.map(s => s.name);

  while (true) {
    console.log('\n');
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: '请选择要执行的操作:',
        choices: [
          { name: '📊 查看拓扑图', value: 'topology' },
          { name: '⚡ 查看关键路径', value: 'criticalPath' },
          { name: '🚨 故障模拟分析', value: 'simulate' },
          { name: '📋 查看服务详情', value: 'serviceDetails' },
          { name: '📈 查看性能指标', value: 'performance' },
          { name: '📄 生成HTML报告', value: 'html' },
          { name: '❌ 退出', value: 'exit' }
        ]
      }
    ]);

    switch (action) {
      case 'topology':
        const asciiOutput = topology.format('ascii', {
          color: options.color !== false,
          showDetails: false
        });
        console.log('\n' + asciiOutput);
        break;

      case 'criticalPath':
        const { criticalPath, totalDuration, bottleneckServices } = analysis.criticalPath;
        console.log(chalk.cyan.bold('\n⚡ 关键路径分析\n'));
        console.log(`总耗时: ${totalDuration}ms\n`);
        
        let pathStr = '';
        criticalPath.forEach((service, index) => {
          const health = analysis.health.services[service];
          let serviceText = service;
          if (options.color !== false) {
            if (health?.healthStatus === 'healthy') serviceText = chalk.green(serviceText);
            else if (health?.healthStatus === 'degraded') serviceText = chalk.yellow(serviceText);
            else if (health?.healthStatus === 'unhealthy') serviceText = chalk.red(serviceText);
            serviceText = chalk.bold(serviceText);
          }
          pathStr += serviceText;
          if (index < criticalPath.length - 1) {
            pathStr += options.color !== false ? chalk.cyan(' → ') : ' → ';
          }
        });
        console.log(`  ${pathStr}\n`);
        break;

      case 'simulate':
        await runInteractiveSimulation(simulator, serviceNames);
        break;

      case 'serviceDetails':
        const { selectedService } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedService',
            message: '选择要查看的服务:',
            choices: serviceNames,
            pageSize: 15
          }
        ]);
        
        const serviceHealth = analysis.health.services[selectedService];
        const servicePerf = analysis.performance.serviceMetrics[selectedService];
        const deps = analysis.dependencies;
        
        console.log(chalk.cyan.bold(`\n📋 服务详情: ${selectedService}\n`));
        console.log(`  状态: ${serviceHealth.healthStatus} (${serviceHealth.score}/100)`);
        console.log(`  实例数: ${serviceHealth.instanceCount}`);
        console.log(`  CPU: ${serviceHealth.cpuUsage}% | 内存: ${serviceHealth.memoryUsage}%`);
        console.log(`  版本: ${serviceHealth.version} | 运行时间: ${serviceHealth.uptime}`);
        console.log(`  入站请求: ${servicePerf?.totalIncomingRequests || 0}/s`);
        console.log(`  出站请求: ${servicePerf?.totalOutgoingRequests || 0}/s`);
        console.log(`  平均延迟: ${servicePerf?.avgIncomingLatency?.toFixed(0) || 0}ms`);
        console.log(`  错误率: ${servicePerf?.errorRate?.toFixed(2) || 0}%`);
        
        const outDeps = deps.adjacencyList[selectedService] || [];
        const inDeps = deps.reverseAdjacencyList[selectedService] || [];
        console.log(`  依赖服务 (${outDeps.length}): ${outDeps.map(d => d.service).join(', ') || '无'}`);
        console.log(`  被依赖服务 (${inDeps.length}): ${inDeps.map(d => d.service).join(', ') || '无'}`);
        
        if (serviceHealth.issues.length > 0) {
          console.log(chalk.yellow('\n  存在问题:'));
          serviceHealth.issues.forEach(issue => {
            console.log(`    - ${issue.message}`);
          });
        }
        break;

      case 'performance':
        const perf = analysis.performance;
        const edges = Object.values(perf.edgeMetrics);
        const avgLatency = edges.length > 0 
          ? Math.round(edges.reduce((sum, e) => sum + e.avgLatency, 0) / edges.length)
          : 0;
        const avgErrorRate = edges.length > 0
          ? (edges.reduce((sum, e) => sum + e.errorRate, 0) / edges.length).toFixed(2)
          : 0;

        console.log(chalk.cyan.bold('\n📈 性能指标汇总\n'));
        console.log(`  平均延迟: ${avgLatency}ms`);
        console.log(`  平均错误率: ${avgErrorRate}%`);
        console.log(`  慢调用数: ${perf.slowEdges.length}`);
        console.log(`  高错误调用数: ${perf.highErrorEdges.length}\n`);

        if (perf.bottlenecks.length > 0) {
          console.log(chalk.red.bold('性能瓶颈:\n'));
          perf.bottlenecks.slice(0, 5).forEach((b, i) => {
            console.log(`  ${i + 1}. ${b.edge} [负载: ${Math.round(b.load)}]`);
            b.issues.forEach(issue => {
              console.log(`     - ${issue.message}`);
            });
          });
        }
        break;

      case 'html':
        const htmlOutput = topology.format('html', {
          outputPath: options.output || 'topology-report.html'
        });
        console.log(chalk.green.bold(`\n📄 ${htmlOutput}`));
        break;

      case 'exit':
        console.log(chalk.cyan('\n👋 再见!'));
        process.exit(0);
    }
  }
}

program.parseAsync(process.argv);
