const path=require('node:path');
const HtmlWebpackPlugin=require('html-webpack-plugin');
const base=require('./webpack.config');
module.exports={...base,devtool:false,entry:'./src/report-viewer.tsx',output:{path:path.resolve(process.env.REPORT_VIEWER_OUTPUT || 'dist-report-viewer'),filename:'desktop-report.[contenthash].js',clean:true},plugins:[new HtmlWebpackPlugin({template:'./index.html',filename:'desktop-report.html',inject:'body'})]};
