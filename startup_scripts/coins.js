/**
 * @file coins.js
 * @brief Startup script for registering custom currency coins.
 *        启动脚本：注册自定义货币硬币物品。
 * @author CreateGo Team
 * @date 2026-08-04
 */

StartupEvents.registry('item', event => {
    // Register Copper Coin with custom texture / 注册铜币并设置自定义贴图
    event.create('creatego:coin_copper')
        .displayName('铜币')
        .texture('creatego:item/coin_copper');
    
    // Register Silver Coin with custom texture (1 Silver = 100 Coppers) / 注册银币并设置自定义贴图 (1 银币 = 100 铜币)
    event.create('creatego:coin_silver')
        .displayName('银币')
        .texture('creatego:item/coin_silver');
    
    // Register Gold Coin with custom texture (1 Gold = 100 Silvers = 10000 Coppers) / 注册金币并设置自定义贴图 (1 金币 = 100 银币 = 10000 铜币)
    event.create('creatego:coin_gold')
        .displayName('金币')
        .texture('creatego:item/coin_gold');
});
