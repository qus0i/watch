#!/usr/bin/env node

/**
 * أداة سطر الأوامر للتحكم بالساعة
 * Command Line Interface for Watch Control
 */

const ProtocolBuilder = require('./protocol/builder');
const { sendCommandToDevice } = require('./server');

// ألوان للطباعة
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function print(message, color = 'reset') {
  console.log(colors[color] + message + colors.reset);
}

function printHelp() {
  print('\n📱 أداة التحكم بساعة GPS\n', 'cyan');
  console.log('الاستخدام: node cli.js <command> <imei> [options]\n');
  console.log('الأوامر المتاحة:');
  console.log('  location <imei>              - طلب موقع فوري');
  console.log('  heartrate <imei>             - قياس النبض');
  console.log('  bloodpressure <imei>         - قياس ضغط الدم');
  console.log('  temperature <imei>           - قياس الحرارة');
  console.log('  oxygen <imei>                - قياس الأكسجين');
  console.log('  sos <imei> <num1> <num2> <num3> - ضبط أرقام SOS');
  console.log('  mode <imei> <1|2|3>          - تغيير وضع العمل');
  console.log('  falldetect <imei> <on|off>   - تفعيل/إيقاف كشف الوقوع');
  console.log('  reset <imei>                 - إعادة ضبط المصنع');
  console.log('\nأمثلة:');
  console.log('  node cli.js location 353456789012345');
  console.log('  node cli.js sos 353456789012345 +962791234567 +962791234568 +962791234569');
  console.log('  node cli.js mode 353456789012345 1\n');
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  const command = args[0].toLowerCase();
  const imei = args[1];

  if (!imei || imei.length !== 15) {
    print('❌ خطأ: IMEI يجب أن يكون 15 رقم', 'red');
    process.exit(1);
  }

  let commandString = '';

  try {
    switch (command) {
      case 'location':
        commandString = ProtocolBuilder.buildLocationRequest(imei);
        print(`📍 طلب موقع من ${imei}...`, 'cyan');
        break;

      case 'heartrate':
      case 'hr':
        commandString = ProtocolBuilder.buildHeartRateTestCommand(imei);
        print(`❤️ طلب قياس النبض من ${imei}...`, 'cyan');
        break;

      case 'bloodpressure':
      case 'bp':
        commandString = ProtocolBuilder.buildBloodPressureTestCommand(imei);
        print(`💉 طلب قياس الضغط من ${imei}...`, 'cyan');
        break;

      case 'temperature':
      case 'temp':
        commandString = ProtocolBuilder.buildTemperatureTestCommand(imei);
        print(`🌡️ طلب قياس الحرارة من ${imei}...`, 'cyan');
        break;

      case 'oxygen':
      case 'spo2':
        commandString = ProtocolBuilder.buildOxygenTestCommand(imei);
        print(`🫁 طلب قياس الأكسجين من ${imei}...`, 'cyan');
        break;

      case 'sos':
        const numbers = args.slice(2, 5);
        if (numbers.length < 3) {
          print('❌ خطأ: يجب توفير 3 أرقام SOS', 'red');
          process.exit(1);
        }
        commandString = ProtocolBuilder.buildSetSOSCommand(imei, null, numbers);
        print(`📞 ضبط أرقام SOS: ${numbers.join(', ')}`, 'cyan');
        break;

      case 'mode':
        const mode = parseInt(args[2]);
        if (![1, 2, 3].includes(mode)) {
          print('❌ خطأ: الوضع يجب أن يكون 1، 2، أو 3', 'red');
          process.exit(1);
        }
        commandString = ProtocolBuilder.buildSetWorkingModeCommand(imei, null, mode);
        const modeName = mode === 1 ? 'عادي' : mode === 2 ? 'توفير طاقة' : 'طوارئ';
        print(`⚙️ تغيير الوضع إلى: ${modeName}`, 'cyan');
        break;

      case 'falldetect':
      case 'fall':
        const enable = args[2]?.toLowerCase() === 'on';
        commandString = ProtocolBuilder.buildFallDetectionCommand(imei, null, enable);
        print(`🤸 ${enable ? 'تفعيل' : 'إيقاف'} كشف الوقوع`, 'cyan');
        break;

      case 'reset':
        commandString = ProtocolBuilder.buildFactoryResetCommand(imei);
        print('⚠️ إعادة ضبط المصنع...', 'yellow');
        break;

      default:
        print(`❌ أمر غير معروف: ${command}`, 'red');
        printHelp();
        process.exit(1);
    }

    // إرسال الأمر
    print(`📤 إرسال: ${commandString}`, 'green');
    const success = sendCommandToDevice(imei, commandString);
    
    if (success) {
      print('✅ تم إرسال الأمر بنجاح', 'green');
    } else {
      print('⚠️ الجهاز غير متصل حالياً', 'yellow');
    }

  } catch (err) {
    print(`❌ خطأ: ${err.message}`, 'red');
    process.exit(1);
  }
}

// تشغيل الأداة
main();
