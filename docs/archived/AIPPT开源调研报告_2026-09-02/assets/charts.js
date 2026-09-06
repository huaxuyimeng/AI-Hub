(function () {
  if (typeof echarts === 'undefined') return;

  var chart = echarts.init(document.getElementById('chart-stars'), null, { renderer: 'canvas' });

  var data = [
    { name: 'PPT Master', value: 50031, route: '路线 A · 代码排版' },
    { name: 'Presenton', value: 9960, route: '路线 C · HTML 渲染' },
    { name: 'PptxGenJS（底层库）', value: 6100, route: '路线 A · 依赖库' },
    { name: 'PPTAgent', value: 4304, route: '路线 B · 模板编辑' },
    { name: 'ppt-agent (cobacha)', value: 1, route: '路线 A · 代码排版' }
  ];

  chart.setOption({
    backgroundColor: '#FFFFFF',
    grid: { left: 8, right: 40, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: function (params) {
        var p = params[0];
        var d = data[p.dataIndex];
        return d.name + '<br/>Stars: ' + d.value.toLocaleString() + '<br/>' + d.route;
      }
    },
    xAxis: {
      type: 'value',
      axisLabel: {
        color: '#5B6B84',
        fontFamily: 'JetBrainsMono, monospace',
        fontSize: 11,
        formatter: function (v) {
          return v >= 1000 ? (v / 1000) + 'k' : v;
        }
      },
      splitLine: { lineStyle: { color: '#E4EAF3' } },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: data.map(function (d) { return d.name; }),
      axisLabel: { color: '#16233A', fontSize: 13, fontFamily: 'WorkSans, Microsoft YaHei, sans-serif' },
      axisLine: { lineStyle: { color: '#E4EAF3' } },
      axisTick: { show: false }
    },
    series: [{
      type: 'bar',
      data: data.map(function (d) {
        return {
          value: d.value,
          itemStyle: {
            color: d.value > 1000 ? '#2563EB' : '#0891B2',
            borderRadius: [0, 4, 4, 0]
          }
        };
      }),
      barWidth: '55%',
      label: {
        show: true,
        position: 'right',
        color: '#5B6B84',
        fontFamily: 'JetBrainsMono, monospace',
        fontSize: 11,
        formatter: function (p) {
          return p.value >= 1000 ? (p.value / 1000).toFixed(1) + 'k' : p.value;
        }
      }
    }]
  });

  window.addEventListener('resize', function () { chart.resize(); });
})();
