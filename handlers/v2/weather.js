/**
 * ═══════════════════════════════════════════════════════════════
 *  v2 Weather Handler — upWeather → dnWeather (mock)
 * ═══════════════════════════════════════════════════════════════
 *
 *  مرجع SDK: page 37
 *
 *  الجهاز يطلب weather بعد اللوقن غالباً. الـ schema مطلوب من السيرفر:
 *    {
 *      type: 'dnWeather',
 *      ident: <same as request>,
 *      ref: 's:reply',
 *      imei,
 *      data: { type, imei, weather, weatherType, temperature,
 *              daytemp, nighttemp, humidity, windpower,
 *              "wind direction", reporttime, timestamp },
 *      timestamp
 *    }
 *
 *  TODO: استبدل الـ static payload بـ API حقيقي (مثلاً OpenWeather)
 *  مبني على آخر موقع للساعة (locations / locations_v2). لحد ما يصير
 *  ذلك، هذا الـ mock يكفي عشان الجهاز ما يبقى ينتظر رد ويعتمد على
 *  fallback غير مرغوب.
 */

const builder = require('../../protocol/v2/builder');

async function handleUpWeather(req, ctx) {
  const imei = req.imei || ctx.socket.imei || '';
  const ts = Date.now();

  const envelope = {
    type: 'dnWeather',
    ident: req.ident || builder._genIdent(),
    ref: 's:reply',
    imei,
    data: {
      type: 'dnWeather',
      imei,
      weather: 'Sunny',
      weatherType: 0,
      temperature: '25',
      daytemp: '30',
      nighttemp: '20',
      humidity: '50',
      windpower: '3',
      'wind direction': 'northwest',
      reporttime: new Date(ts).toISOString(),
      timestamp: ts,
    },
    timestamp: ts,
  };

  ctx.logger.info(`☀️  [v2] dnWeather (mock) → imei=${imei}`);
  ctx.sendResponse(envelope);
}

module.exports = {
  upWeather: handleUpWeather,
};
