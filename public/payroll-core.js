(function (root) {
  'use strict';
  var LABEL = { night: '야간수당', overtime: '연장수당', holiday: '휴일수당', weekly: '주휴수당' };
  var DEFAULT_MIN_WAGES = { 2025: 10030, 2026: 10320 };
  var won = function (n) { return Math.round(+n).toLocaleString('ko-KR') + '원'; };

  function calculate(r, options) {
    r = r || {};
    var wages = options && options.minWages ? options.minWages : DEFAULT_MIN_WAGES;

    function hm(t) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(t == null ? '' : t))) throw Error('출근·퇴근 시간을 확인하세요');
      return +String(t).slice(0, 2) * 60 + +String(t).slice(3, 5);
    }
    function num(key, label) {
      var s = r[key] == null ? '' : String(r[key]).trim();
      if (s === '') throw Error(label + '을 입력하세요');
      if (!/^\d{1,12}$/.test(s)) throw Error(label + '은 0 이상 정수로 입력하세요');
      var n = +s;
      if (!Number.isSafeInteger(n) || n > 100000000) throw Error(label + ' 숫자를 확인하세요');
      return n;
    }

    var s = hm(r.start), e = hm(r.end);
    if (e < s) e += 1440;
    var rest = num('rest', '무급 휴게시간');
    var rate = num('rate', '기본 시급');
    var ordinary = num('ordinary', '통상시급');
    var work = e - s - rest;
    if (work <= 0) throw Error('근무시간과 휴게시간을 확인하세요');

    var nightMinutes = num('nightMinutes', '야간근로 시간');
    var overtimeMinutes = num('overtimeMinutes', '연장근로 시간');
    var holidayMinutes = num('holidayMinutes', '휴일근로 시간');
    var weeklyMinutes = num('weeklyMinutes', '주휴 유급시간');

    var overlap = 0;
    for (var i = s; i < e; i++) if (i % 1440 >= 1320 || i % 1440 < 360) overlap++;
    if (nightMinutes > Math.min(work, overlap)) throw Error('야간근로 시간은 실제 야간 근로시간(' + Math.min(work, overlap) + '분)을 넘을 수 없습니다');
    if (overtimeMinutes > work) throw Error('연장근로 시간은 총 근로시간을 넘을 수 없습니다');
    if (holidayMinutes > work) throw Error('휴일근로 시간은 총 근로시간을 넘을 수 없습니다');

    var year = String(r.day || '').slice(0, 4);
    var minWage = wages[year] ? +wages[year] : 0;
    var size = r.size === 'large' ? 'large' : r.size === 'small' ? 'small' : 'unknown';
    var red = [], yellow = [];

    if (!minWage) yellow.push((year || '해당') + '년 법정 최저임금 기준이 등록되지 않았습니다 — 관리자 확인 필요');
    else if (rate < minWage) red.push('기본 시급이 ' + year + '년 최저임금에 미달합니다: ' + won(minWage - rate) + '/시간 부족 (기준 ' + won(minWage) + ')');
    if (ordinary < rate) yellow.push('통상시급이 기본 시급보다 낮습니다 — 관리자 확인 필요');
    if (size === 'unknown') yellow.push('사업장 규모(상시근로자 5인 이상 여부) 미확인 — 관리자 확인 필요');
    if (r.review !== 'yes') yellow.push('주간 근로·휴일·계약 조건 검토 미완료 — 관리자 확인 필요');
    if ((work >= 480 && rest < 60) || (work >= 240 && rest < 30)) yellow.push('휴게시간이 법정 기준에 미달합니다(4시간 이상 30분, 8시간 이상 60분) — 관리자 확인 필요');
    if (holidayMinutes > 480 && overtimeMinutes > 0) yellow.push('휴일 8시간 초과분과 연장근로 시간이 함께 입력되어 중복 가산될 수 있습니다 — 관리자 확인 필요');

    var nightAmount = num('night', '야간 추가 수당');
    if (r.nightRateMode === 'rate') {
      var nightRate = num('nightRate', '야간 시급');
      if (nightMinutes > 0 && nightRate < rate) yellow.push('야간 시급이 기본 시급보다 낮습니다 — 관리자 확인 필요');
      nightAmount = Math.max(0, Math.round((nightRate - rate) * nightMinutes / 60));
    }
    var amounts = {
      night: nightAmount,
      overtime: num('overtime', '연장 추가 수당'),
      holiday: num('holiday', '휴일 추가 수당'),
      weekly: num('weekly', '주휴수당')
    };
    var minutes = { night: nightMinutes, overtime: overtimeMinutes, holiday: holidayMinutes, weekly: weeklyMinutes };
    // 휴일 8시간 이내는 0.5, 8시간 초과분은 1.0 가산(초과분은 연장과 중복되지 않도록 여기서만 계산)
    var holidayUnits = Math.min(holidayMinutes, 480) + 2 * Math.max(0, holidayMinutes - 480);
    var required = {
      night: Math.ceil(nightMinutes * ordinary * 0.5 / 60),
      overtime: Math.ceil(overtimeMinutes * ordinary * 0.5 / 60),
      holiday: Math.ceil(holidayUnits * ordinary * 0.5 / 60),
      weekly: Math.ceil(weeklyMinutes * ordinary / 60)
    };

    var items = [], extra = 0;
    ['night', 'overtime', 'holiday', 'weekly'].forEach(function (k) {
      var mandatory = k === 'weekly' ? true : size === 'large';
      var req = mandatory && minutes[k] > 0 ? required[k] : 0;
      if (amounts[k] < req) {
        red.push(LABEL[k] + '이 법정 기준에 미달합니다: ' + won(req - amounts[k]) + ' 부족 (필요 ' + won(req) + ' / 입력 ' + won(amounts[k]) + ')');
      }
      extra += amounts[k];
      items.push({ key: k, label: LABEL[k], minutes: minutes[k], amount: amounts[k], required: req, mandatory: mandatory });
    });

    var otherTotal = 0, otherItems = [];
    var list = Array.isArray(r.otherItems) ? r.otherItems : [];
    if (list.length > 50) throw Error('기타 수당 항목은 50개까지 입력할 수 있습니다');
    list.forEach(function (it) {
      var title = String(it && it.title != null ? it.title : '').trim();
      var raw = it && it.amount != null ? String(it.amount).trim() : '';
      if (!title && raw === '') return;
      if (!title) throw Error('기타 수당 항목명을 입력하세요');
      if (!/^\d{1,12}$/.test(raw)) throw Error('기타 수당 금액을 확인하세요');
      otherTotal += +raw;
      otherItems.push({ title: title.slice(0, 50), amount: +raw });
    });
    // 이전 버전 기록의 단일 기타 수당(other)도 계속 합산한다.
    if (!otherItems.length && r.other != null && String(r.other).trim() !== '') {
      var legacy = String(r.other).trim();
      if (!/^\d{1,12}$/.test(legacy)) throw Error('기타 수당 금액을 확인하세요');
      otherTotal += +legacy;
    }
    extra += otherTotal;

    var base = Math.ceil(work * rate / 60);
    return {
      base: base, extra: extra, total: base + extra, work: work, min: minWage,
      red: red, yellow: yellow, items: items, otherItems: otherItems, otherTotal: otherTotal,
      night: nightAmount, required: required
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = calculate;
  else root.payrollCalculate = calculate;
})(globalThis);
