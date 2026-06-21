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
  .option('--save-history', '保存诊断结果到历史快照')
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

      if (options.saveHistory) {
        await showProgress('保存历史快照', async () => {
          topology.saveHistory(options.source);
        });
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

      const { wantNotify } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'wantNotify',
          message: '是否要发送故障报告通知?',
          default: false
        }
      ]);

      if (wantNotify) {
        await askForNotification(topology, 'failure', result);
      }

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

program
  .command('history')
  .description('历史快照管理')
  .option('--list', '列出所有历史快照')
  .option('--stats', '显示存储统计信息')
  .option('--compare', '对比历史数据，检测异常漂移')
  .option('--clear', '清除所有历史快照')
  .option('-s, --source <type>', '数据源类型: mock|consul|eureka|docker-compose|k8s', 'mock')
  .option('--host <host>', '服务注册中心主机地址', 'localhost')
  .option('--port <port>', '服务注册中心端口', type => parseInt(type))
  .option('--no-color', '禁用彩色输出')
  .action(async (options) => {
    try {
      const topology = new MicroserviceTopology();

      if (options.list) {
        console.log(chalk.cyan.bold('\n📜 历史快照列表\n'));
        const list = topology.listHistory();
        if (list.length === 0) {
          console.log(chalk.gray('  暂无历史快照\n'));
        } else {
          list.forEach((item, index) => {
            const time = new Date(item.timestamp).toLocaleString('zh-CN');
            const score = item.summary?.healthScore !== undefined 
              ? `健康评分: ${item.summary.healthScore.toFixed(1)}` 
              : '';
            console.log(`  ${index + 1}. [${time}] ${item.source} - ${item.summary?.serviceCount || 0}个服务 ${score}`);
          });
          console.log(`\n  共 ${list.length} 个快照\n`);
        }
      }

      if (options.stats) {
        console.log(chalk.cyan.bold('\n📊 存储统计\n'));
        const stats = topology.getHistoryStats();
        console.log(`  快照总数: ${stats.snapshotCount}`);
        console.log(`  总大小: ${(stats.totalSizeBytes / 1024).toFixed(2)} KB`);
        console.log(`  存储目录: ${stats.storageDir}\n`);
      }

      if (options.compare) {
        const config = buildAdapterConfig(options);
        console.log(chalk.cyan.bold('\n🔄 对比历史数据，检测异常漂移...\n'));

        await showProgress('连接数据源', async () => {
          await topology.connect(options.source, config);
        });

        await showProgress('收集服务数据', async () => {
          await topology.collect();
        });

        await showProgress('分析依赖关系', async () => {
          topology.analyze();
        });

        await showProgress('保存当前快照', async () => {
          topology.saveHistory(options.source);
        });

        const result = await showProgress('检测异常漂移', async () => {
          return topology.compareHistory({ 
            minSnapshots: 3,
            driftThreshold: 0.1,
            severityThreshold: 'medium'
          });
        });

        console.log(result.reportText);

        if (result.drift.anomalies.length > 0) {
          const { wantNotify } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'wantNotify',
              message: '检测到异常，是否发送漂移报告通知?',
              default: false
            }
          ]);

          if (wantNotify) {
            await askForNotification(topology, 'drift', result);
          }
        }
      }

      if (options.clear) {
        const { confirmClear } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmClear',
            message: chalk.red.bold('确定要清除所有历史快照吗? 此操作不可恢复!'),
            default: false
          }
        ]);

        if (confirmClear) {
          topology.clearHistory();
          console.log(chalk.green.bold('\n✅ 所有历史快照已清除\n'));
        } else {
          console.log(chalk.gray('\n  操作已取消\n'));
        }
      }

      if (!options.list && !options.stats && !options.compare && !options.clear) {
        console.log(chalk.yellow('请使用 --list, --stats, --compare 或 --clear 选项\n'));
        program.outputHelp();
      }

    } catch (error) {
      console.error(chalk.red.bold(`❌ 历史管理失败: ${error.message}`));
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program
  .command('notify')
  .description('发送诊断通知')
  .option('-s, --source <type>', '数据源类型: mock|consul|eureka|docker-compose|k8s', 'mock')
  .option('--host <host>', '服务注册中心主机地址', 'localhost')
  .option('--port <port>', '服务注册中心端口', type => parseInt(type))
  .option('--type <notificationType>', '通知方式: email|slack')
  .option('--notify-type <contentType>', '通知内容类型: analysis|drift|failure', 'analysis')
  .option('--smtp-host <host>', 'SMTP服务器地址')
  .option('--smtp-port <port>', 'SMTP服务器端口', type => parseInt(type), 587)
  .option('--smtp-user <user>', 'SMTP用户名')
  .option('--smtp-pass <pass>', 'SMTP密码')
  .option('--smtp-from <from>', '发件人邮箱')
  .option('--smtp-to <to>', '收件人邮箱(多个用逗号分隔)')
  .option('--slack-webhook <url>', 'Slack Webhook URL')
  .option('--slack-channel <channel>', 'Slack频道')
  .option('--severity-threshold <level>', '通知阈值: low|medium|high|critical', 'medium')
  .action(async (options) => {
    try {
      const topology = new MicroserviceTopology();
      const config = buildAdapterConfig(options);

      await showProgress('连接数据源', async () => {
        await topology.connect(options.source, config);
      });

      await showProgress('收集服务数据', async () => {
        await topology.collect();
      });

      await showProgress('分析依赖关系', async () => {
        topology.analyze();
      });

      let notifyType = options.type;
      if (!notifyType) {
        const answers = await inquirer.prompt([
          {
            type: 'list',
            name: 'notifyType',
            message: '请选择通知方式:',
            choices: ['email', 'slack']
          }
        ]);
        notifyType = answers.notifyType;
      }

      const notifyConfig = await buildNotifyConfig(notifyType, options);

      await showProgress(`发送${notifyType === 'email' ? '邮件' : 'Slack'}通知`, async () => {
        await topology.notify(notifyType, notifyConfig, {
          notifyType: options.notifyType,
          severityThreshold: options.severityThreshold
        });
      });

      console.log(chalk.green.bold('\n✅ 通知发送成功!\n'));

    } catch (error) {
      console.error(chalk.red.bold(`❌ 发送通知失败: ${error.message}`));
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program
  .command('watch')
  .description('持续监控模式：定时诊断并检测异常漂移')
  .option('-s, --source <type>', '数据源类型: mock|consul|eureka|docker-compose|k8s', 'mock')
  .option('-e, --every <interval>', '运行间隔 (30s, 1m, 5m, 1h, 1d)', '1m')
  .option('--host <host>', '服务注册中心主机地址', 'localhost')
  .option('--port <port>', '服务注册中心端口', type => parseInt(type))
  .option('--enable-drift', '启用异常漂移检测')
  .option('--notify-drift', '检测到漂移时发送通知')
  .option('--notify-degraded', '集群非健康时发送通知')
  .option('--type <notificationType>', '通知方式: email|slack')
  .option('--smtp-host <host>', 'SMTP服务器地址')
  .option('--smtp-port <port>', 'SMTP服务器端口', type => parseInt(type), 587)
  .option('--smtp-user <user>', 'SMTP用户名')
  .option('--smtp-pass <pass>', 'SMTP密码')
  .option('--smtp-from <from>', '发件人邮箱')
  .option('--smtp-to <to>', '收件人邮箱(多个用逗号分隔)')
  .option('--slack-webhook <url>', 'Slack Webhook URL')
  .option('--slack-channel <channel>', 'Slack频道')
  .option('--no-color', '禁用彩色输出')
  .action(async (options) => {
    try {
      console.log(chalk.cyan.bold('👀 持续监控模式\n'));
      console.log(chalk.gray(`  数据源: ${options.source}`));
      console.log(chalk.gray(`  运行间隔: ${options.every}`));
      console.log(chalk.gray(`  漂移检测: ${options.enableDrift ? '已启用' : '未启用'}`));
      console.log(chalk.gray(`  按 Ctrl+C 停止监控\n`));

      const topology = new MicroserviceTopology();
      const config = buildAdapterConfig(options);

      let notifyConfig = null;
      if (options.notifyDrift || options.notifyDegraded) {
        let notifyType = options.type;
        if (!notifyType) {
          const answers = await inquirer.prompt([
            {
              type: 'list',
              name: 'notifyType',
              message: '请选择通知方式:',
              choices: ['email', 'slack']
            }
          ]);
          notifyType = answers.notifyType;
        }
        notifyConfig = await buildNotifyConfig(notifyType, options);
      }

      const watchOptions = {
        interval: options.every,
        enableDrift: options.enableDrift,
        notifyDrift: options.notifyDrift,
        notifyDegraded: options.notifyDegraded,
        notifyType: options.type,
        notifyConfig: notifyConfig,
        onDiagnosis: (result, iteration) => {
          const time = new Date().toLocaleTimeString('zh-CN');
          const status = result.analysis.health.healthStatus === 'healthy' 
            ? chalk.green('健康') 
            : result.analysis.health.healthStatus === 'degraded'
              ? chalk.yellow('降级')
              : chalk.red('异常');
          console.log(`[${time}] 第${iteration}次诊断完成 - 集群状态: ${status} - 健康评分: ${result.analysis.health.healthScore.toFixed(1)}`);
          
          if (result.drift && result.drift.anomalies.length > 0) {
            console.log(chalk.yellow(`  检测到 ${result.drift.anomalies.length} 个异常漂移`));
          }
        },
        onError: (error) => {
          const time = new Date().toLocaleTimeString('zh-CN');
          console.error(chalk.red(`[${time}] 诊断错误: ${error.message}`));
        }
      };

      topology.watch(options.source, watchOptions);

      process.on('SIGINT', () => {
        console.log(chalk.cyan('\n\n👋 正在停止监控...'));
        topology.stopSchedule('watch');
        console.log(chalk.cyan('监控已停止，再见!\n'));
        process.exit(0);
      });

    } catch (error) {
      console.error(chalk.red.bold(`❌ 监控启动失败: ${error.message}`));
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program
  .command('schedule')
  .description('定时任务管理')
  .option('-s, --source <type>', '数据源类型: mock|consul|eureka|docker-compose|k8s', 'mock')
  .option('--host <host>', '服务注册中心主机地址', 'localhost')
  .option('--port <port>', '服务注册中心端口', type => parseInt(type))
  .option('--cron <expression>', 'Cron表达式 (如: */5 * * * *)')
  .option('-e, --every <interval>', '简化间隔 (30s, 1m, 5m, 1h, 1d)')
  .option('--list', '列出所有定时任务')
  .option('--stop <name>', '停止指定任务')
  .option('--stop-all', '停止所有任务')
  .option('--enable-drift', '启用异常漂移检测')
  .option('--notify-drift', '检测到漂移时发送通知')
  .option('--notify-degraded', '集群非健康时发送通知')
  .option('--type <notificationType>', '通知方式: email|slack')
  .option('--smtp-host <host>', 'SMTP服务器地址')
  .option('--smtp-port <port>', 'SMTP服务器端口', type => parseInt(type), 587)
  .option('--smtp-user <user>', 'SMTP用户名')
  .option('--smtp-pass <pass>', 'SMTP密码')
  .option('--smtp-from <from>', '发件人邮箱')
  .option('--smtp-to <to>', '收件人邮箱(多个用逗号分隔)')
  .option('--slack-webhook <url>', 'Slack Webhook URL')
  .option('--slack-channel <channel>', 'Slack频道')
  .action(async (options) => {
    try {
      const topology = new MicroserviceTopology();

      if (options.list) {
        console.log(chalk.cyan.bold('\n📋 定时任务列表\n'));
        const jobs = topology.listSchedules();
        if (jobs.length === 0) {
          console.log(chalk.gray('  暂无定时任务\n'));
        } else {
          jobs.forEach((job, index) => {
            const nextRun = job.nextInvocation ? new Date(job.nextInvocation).toLocaleString('zh-CN') : '未知';
            console.log(`  ${index + 1}. ${chalk.bold(job.name)}`);
            console.log(`     类型: ${job.type} | 状态: ${job.running ? chalk.green('运行中') : chalk.yellow('已停止')}`);
            console.log(`     下次执行: ${nextRun}`);
            if (job.cron) console.log(`     Cron: ${job.cron}`);
            if (job.interval) console.log(`     间隔: ${job.interval}`);
            console.log();
          });
        }
        return;
      }

      if (options.stop) {
        topology.stopSchedule(options.stop);
        console.log(chalk.green.bold(`\n✅ 任务 "${options.stop}" 已停止\n`));
        return;
      }

      if (options.stopAll) {
        topology.stopAllSchedules();
        console.log(chalk.green.bold('\n✅ 所有任务已停止\n'));
        return;
      }

      if (!options.cron && !options.every) {
        console.log(chalk.yellow('请使用 --cron 或 --every 指定定时规则\n'));
        program.outputHelp();
        return;
      }

      console.log(chalk.cyan.bold('\n⏰ 创建定时任务\n'));

      let notifyConfig = null;
      if (options.notifyDrift || options.notifyDegraded) {
        let notifyType = options.type;
        if (!notifyType) {
          const answers = await inquirer.prompt([
            {
              type: 'list',
              name: 'notifyType',
              message: '请选择通知方式:',
              choices: ['email', 'slack']
            }
          ]);
          notifyType = answers.notifyType;
        }
        notifyConfig = await buildNotifyConfig(notifyType, options);
      }

      const scheduleOptions = {
        cron: options.cron,
        interval: options.every,
        enableDrift: options.enableDrift,
        notifyDrift: options.notifyDrift,
        notifyDegraded: options.notifyDegraded,
        notifyType: options.type,
        notifyConfig: notifyConfig,
        onDiagnosis: (result, iteration) => {
          const time = new Date().toLocaleTimeString('zh-CN');
          const status = result.analysis.health.healthStatus === 'healthy' 
            ? chalk.green('健康') 
            : result.analysis.health.healthStatus === 'degraded'
              ? chalk.yellow('降级')
              : chalk.red('异常');
          console.log(`[${time}] 诊断完成 - 集群状态: ${status} - 健康评分: ${result.analysis.health.healthScore.toFixed(1)}`);
        },
        onError: (error) => {
          const time = new Date().toLocaleTimeString('zh-CN');
          console.error(chalk.red(`[${time}] 诊断错误: ${error.message}`));
        }
      };

      const jobName = topology.schedule(options.source, scheduleOptions, {
        host: options.host,
        port: options.port
      });

      if (options.cron) {
        console.log(chalk.green.bold(`\n✅ 定时任务已创建，Cron: ${options.cron}`));
      } else {
        console.log(chalk.green.bold(`\n✅ 定时任务已创建，间隔: ${options.every}`));
      }
      console.log(chalk.gray(`   任务名称: ${jobName}`));
      console.log(chalk.gray(`   按 Ctrl+C 退出（任务将继续在后台运行）\n`));

      process.on('SIGINT', () => {
        console.log(chalk.cyan('\n\n👋 正在退出...'));
        console.log(chalk.gray('注意：定时任务将继续运行，使用 --stop 或 --stop-all 停止任务\n'));
        process.exit(0);
      });

    } catch (error) {
      console.error(chalk.red.bold(`❌ 定时任务创建失败: ${error.message}`));
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

function buildAdapterConfig(options) {
  const config = {};
  if (options.host) config.host = options.host;
  if (options.port) config.port = options.port;
  return config;
}

async function buildNotifyConfig(type, options) {
  const config = {};

  if (type === 'email') {
    if (options.smtpHost) {
      config.host = options.smtpHost;
      config.port = options.smtpPort;
      config.user = options.smtpUser;
      config.pass = options.smtpPass;
      config.from = options.smtpFrom;
      config.to = options.smtpTo;
    } else {
      const answers = await inquirer.prompt([
        { type: 'input', name: 'host', message: 'SMTP服务器地址:', default: 'smtp.gmail.com' },
        { type: 'input', name: 'port', message: 'SMTP服务器端口:', default: 587 },
        { type: 'input', name: 'user', message: 'SMTP用户名:' },
        { type: 'password', name: 'pass', message: 'SMTP密码:' },
        { type: 'input', name: 'from', message: '发件人邮箱:' },
        { type: 'input', name: 'to', message: '收件人邮箱(多个用逗号分隔):' }
      ]);
      Object.assign(config, answers);
    }
  } else if (type === 'slack') {
    if (options.slackWebhook) {
      config.webhookUrl = options.slackWebhook;
      config.channel = options.slackChannel;
    } else {
      const answers = await inquirer.prompt([
        { type: 'input', name: 'webhookUrl', message: 'Slack Webhook URL:' },
        { type: 'input', name: 'channel', message: 'Slack频道:', default: '#alerts' }
      ]);
      Object.assign(config, answers);
    }
  }

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
    const result = await task();
    clearInterval(spinner);
    process.stdout.write(`\r  ${chalk.green('✓')} ${message}  \n`);
    return result;
  } catch (error) {
    clearInterval(spinner);
    process.stdout.write(`\r  ${chalk.red('✗')} ${message}  \n`);
    throw error;
  }
}

async function askForNotification(topology, notifyType, data) {
  const { notifyChannel } = await inquirer.prompt([
    {
      type: 'list',
      name: 'notifyChannel',
      message: '请选择通知方式:',
      choices: ['email', 'slack', '取消']
    }
  ]);

  if (notifyChannel === '取消') return;

  const config = await buildNotifyConfig(notifyChannel, {});

  await showProgress(`发送${notifyChannel === 'email' ? '邮件' : 'Slack'}通知`, async () => {
    await topology.notify(notifyChannel, config, {
      notifyType: notifyType,
      severityThreshold: 'medium',
      data: data
    });
  });

  console.log(chalk.green.bold('\n✅ 通知发送成功!\n'));
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
          { name: '💾 保存历史快照', value: 'saveHistory' },
          { name: '🔄 异常漂移检测', value: 'drift' },
          { name: '📤 发送通知', value: 'notify' },
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

      case 'saveHistory':
        topology.saveHistory('interactive');
        console.log(chalk.green.bold('\n✅ 历史快照已保存\n'));
        break;

      case 'drift':
        console.log(chalk.cyan.bold('\n🔄 异常漂移检测\n'));
        const driftResult = topology.compareHistory({
          minSnapshots: 3,
          driftThreshold: 0.1,
          severityThreshold: 'medium'
        });
        console.log(driftResult.reportText);
        break;

      case 'notify':
        const { notifyType } = await inquirer.prompt([
          {
            type: 'list',
            name: 'notifyType',
            message: '请选择通知内容类型:',
            choices: [
              { name: '📊 分析报告', value: 'analysis' },
              { name: '🔄 漂移报告', value: 'drift' },
              { name: '🚨 故障报告', value: 'failure' },
              { name: '取消', value: 'cancel' }
            ]
          }
        ]);

        if (notifyType !== 'cancel') {
          let notifyData = null;
          if (notifyType === 'failure') {
            const { failedService } = await inquirer.prompt([
              {
                type: 'list',
                name: 'failedService',
                message: '选择要模拟故障的服务:',
                choices: serviceNames,
                pageSize: 15
              }
            ]);
            notifyData = topology.simulateFailure(failedService);
          }
          await askForNotification(topology, notifyType, notifyData);
        }
        break;

      case 'exit':
        console.log(chalk.cyan('\n👋 再见!'));
        process.exit(0);
    }
  }
}

program.parseAsync(process.argv);
