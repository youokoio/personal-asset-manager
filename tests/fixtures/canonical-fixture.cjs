/* 架空の正規化JSON（dataType: personal_asset_management / schemaVersion 1）を生成する。
   実在の口座・金額は一切含まない。構造は実際の正規化JSONに合わせてある（同条件の建玉が複数、イベントは建玉ごとに1件、投資・暗号資産の配列は空）。 */
function build(){
 const NOW='2026-11-07T21:30:00+09:00';
 const accs=[['ACC-TESTA-001','テスト証券A','TEST FX-A',19,'TRY/JPY'],['ACC-TESTB-001','テスト短資B','TEST FX-B',12,'TRY/JPY'],['ACC-TESTC-001','テスト365','TEST FX-C',4,'ZAR/JPY'],['ACC-TESTD-001','テスト通商D','TEST FX-D',6,'ZAR/JPY']];
 const d={schemaVersion:1,dataType:'personal_asset_management',formatStatus:'intermediate_canonical_format',createdAt:'2026-11-07',description:'テスト用の架空データ',
  rules:{noGuessing:true,noSilentOverwrite:true,unknownValue:'不明な値はnullとし、0で代用しない。'},
  sourceDocuments:[],accounts:[],cashTransactions:[],fees:[],accountBalanceSnapshots:[],fxPositions:[],fxPositionEvents:[],fxSwapRateHistory:[],fxAccountSwapSnapshots:[],
  investmentHoldings:[],investmentAccountSnapshots:[],investmentTransactions:[],cryptoHoldings:[],cryptoTransactions:[],cryptoAccountSnapshots:[],mortgageContracts:[],mortgageRateHistory:[],mortgageRepayments:[],mortgageBalanceSnapshots:[],auditLogs:[],
  migrationNotes:[{date:'2026-11-07',sourceFile:'test.png',decision:'テスト用データを登録。',nextAction:'なし'}]};
 let srcN=0,posN=0;
 accs.forEach(([id,inst,name,n,pair],ai)=>{
  const src=`SRC-T-${String(++srcN).padStart(3,'0')}`;
  d.sourceDocuments.push({sourceDocumentId:src,sourceType:'screenshot',fileName:'test.png',institution:inst,accountId:id,capturedAt:NOW,effectiveDate:'2026-11-05',description:'テスト',extractionTool:'test',verificationStatus:'confirmed',notes:null});
  d.accounts.push({accountId:id,institution:inst,accountName:name,accountType:'fx',baseCurrency:'JPY',status:'active',registeredAt:NOW,updatedAt:NOW,sourceDocumentIds:[src],verificationStatus:'confirmed'});
  let swapSum=0;
  for(let i=0;i<n;i++){
   // 同じ日・同じレート・同じ数量の建玉を意図的に複数作る（実データにも存在するため、1件にまとめてはならない）
   const group=Math.floor(i/3),date=`2025-0${1+(group%9)}-1${ai}`,rate=Number((3.5+group*0.05+ai*0.01).toFixed(2)),qty=(ai===2?10000:200000),lots=qty/(ai===2?1000:10000);
   const pid=`FXP-T-${String(++posN).padStart(3,'0')}`,swap=1000*(i+1)+ai*10;swapSum+=swap;
   d.fxPositions.push({positionId:pid,accountId:id,currencyPair:pair,side:'buy',executionDate:date,originalQuantity:qty,quantityUnit:'currency_units',lots,originalExecutionRate:rate,status:'open',settlementDate:null,settlementRate:null,realizedPnl:null,finalSwap:null,registeredAt:NOW,updatedAt:NOW,sourceDocumentIds:[src],verificationStatus:'confirmed',notes:`No.${i+1}建玉。累積スワップ: ${swap}円`});
   d.fxPositionEvents.push({eventId:`FXE-T-${String(posN).padStart(3,'0')}`,positionId:pid,eventType:'swap_recorded',effectiveDate:'2026-11-05',referenceRate:null,swapAmount:swap,registeredAt:NOW,sourceDocumentIds:[src],verificationStatus:'confirmed'});
  }
  const cash=1000000*(ai+1),unreal=-100000*(ai+1)+(ai%2)*400000;
  d.accountBalanceSnapshots.push({snapshotId:`ABS-T-00${ai+1}`,accountId:id,effectiveDate:'2026-11-05',registeredAt:NOW,currency:'JPY',cashBalance:cash,accountValuation:cash+unreal+swapSum,netAssets:cash+unreal+swapSum,requiredMargin:100000*(ai+1),unrealizedPnl:unreal,cumulativeSwap:swapSum,sourceDocumentIds:[src],verificationStatus:'confirmed',notes:'テスト用の備考'});
 });
 return d;
}
module.exports={build};
if(require.main===module){const out=process.argv[2];if(!out){console.error('usage: node canonical-fixture.cjs <out.json>');process.exit(1);}require('fs').writeFileSync(out,JSON.stringify(build(),null,1));console.log('wrote',out);}
