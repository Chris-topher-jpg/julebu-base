import { randomUUID } from 'node:crypto';
import { requireThat } from './club.mjs';
import { catalogList } from './game-catalog.mjs';

const text = (value,label,max) => { requireThat(typeof value==='string' && value.trim().length>0 && value.trim().length<=max, `${label}不能为空，最多 ${max} 字`); return value.trim(); };
const referencedGame = (data,name) => data.products.some(p=>p.game===name) || data.orders.some(o=>o.game===name) || data.users.some(u=>u.games?.includes(name)) || data.assessments.some(a=>a.game===name);
const referencedProduct = (data,p) => data.orders.some(o=>o.productId===p.id || (!o.productId && o.product===p.name && o.game===p.game));
export function catalogAction(store,user,kind,input) {
  requireThat(['games','products'].includes(kind),'配置类型不存在',404);
  requireThat(['save','state','delete'].includes(input.action),'配置操作无效');
  return store.transaction(user,'account:manage',`${kind==='games'?'游戏':'商品'}配置 · ${input.action}`,data=>{
    const games=kind==='games', rows=games?catalogList(data):data.products;
    const identifier=games?input.originalName:input.id;
    const current=identifier ? rows.find(item=>(games?item.name:item.id)===identifier) : undefined;
    if(identifier) { requireThat(current,'配置不存在',404); requireThat((current.version??0)===input.version,'配置已更新，请刷新后重试',409); }
    if(input.action!=='save')requireThat(current,'请指定要操作的配置');
    if(input.action==='delete') {
      requireThat(!(games?referencedGame(data,current.name):referencedProduct(data,current)),games?'游戏存在业务引用，请下架保留':'商品已被订单引用，请暂停保留',409);
      rows.splice(rows.indexOf(current),1);
      if (games) {
        data.games = data.games.filter(item => item.name !== current.name);
        if (data.gameLevelConfigs) delete data.gameLevelConfigs[current.name];
      }
      return {ok:true};
    }
    const states=games?['上架','下架','维护']:['启用','暂停'];
    requireThat(states.includes(input.state),'配置状态无效');
    const syncGame = previousName => {
      const historical = data.games.find(item => item.name === previousName);
      if (historical) Object.assign(historical, current);
      else data.games.push({ ...current });
    };
    if(input.action==='state'){current.state=input.state;current.version=(current.version??0)+1; if (games) syncGame(current.name); return current;}
    const name=text(input.name,games?'游戏名称':'商品名称',games?40:60);
    let updated;
    if(games){
      requireThat(!rows.some(g=>g!==current && g.name===name),'游戏名称已存在',409);
      if(current && current.name!==name)requireThat(!referencedGame(data,current.name),'游戏存在业务引用，不能修改名称',409);
      requireThat(Number.isInteger(input.min) && Number.isInteger(input.max) && input.min>=1 && input.max<=10 && input.min<=input.max,'每单人数必须为 1–10，且最少人数不能大于最多人数');
      updated={name,category:text(input.category,'游戏分类',30),min:input.min,max:input.max,state:input.state};
    }else{
      const game=text(input.game,'所属游戏',40);
      requireThat(catalogList(data).some(g=>g.name===game),'所属游戏不存在');
      requireThat(input.unit==='小时','商品按小时计价');
      requireThat(Number.isSafeInteger(input.priceCents) && input.priceCents>0 && input.priceCents<=100000000,'价格必须为正数，且最多 100 万元');
      requireThat(typeof input.note==='string' && input.note.length<=300,'服务说明最多 300 字');
      requireThat(!rows.some(p=>p!==current && p.name===name && p.game===game),'同一游戏下商品名称已存在',409);
      // Retain stable links before renaming legacy products whose orders only held names.
      if(current) for(const o of data.orders) if(!o.productId && o.product===current.name && o.game===current.game)o.productId=current.id;
      updated={name,game,unit:'小时',priceCents:input.priceCents,price:`¥ ${(input.priceCents/100).toFixed(2)}`,note:input.note.trim(),state:input.state};
    }
    if(current){
      const previousName = current.name;
      Object.assign(current,updated,{version:(current.version??0)+1});
      if (games) {
        syncGame(previousName);
        if (previousName !== current.name && data.gameLevelConfigs?.[previousName]) {
          data.gameLevelConfigs[current.name] = data.gameLevelConfigs[previousName];
          delete data.gameLevelConfigs[previousName];
        }
      }
      return current;
    }
    const created={...(games?{multiplier:'1.00x',multiplierBps:10000,commissionBps:7000,tone:'blue'}:{id:`product-${randomUUID()}`}),...updated,version:1};
    rows.push(created);
    if (games) {
      const historical = data.games.find(item => item.name === created.name);
      if (historical) Object.assign(historical, created);
      else data.games.push({ ...created });
    }
    return created;
  });
}
