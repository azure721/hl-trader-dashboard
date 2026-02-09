class TraderDashboard {
    constructor() {
        this.traders = new Map();
        this.customNames = JSON.parse(localStorage.getItem('traderCustomNames') || '{}');
        this.init();
    }

    init() {
        document.getElementById('addTraderBtn').onclick = () => {
            const addr = document.getElementById('traderAddress').value.trim();
            if (addr) {
                this.addTrader(addr);
                document.getElementById('traderAddress').value = '';
            }
        };
        document.getElementById('traderAddress').onkeypress = (e) => {
            if (e.key === 'Enter') document.getElementById('addTraderBtn').click();
        };
        document.getElementById('closeModal').onclick = () => {
            document.getElementById('historyModal').classList.remove('show');
        };
        document.getElementById('historyModal').onclick = (e) => {
            if (e.target.id === 'historyModal') document.getElementById('historyModal').classList.remove('show');
        };
        document.getElementById('manualRefreshBtn').onclick = () => this.manualRefresh();

        // Request notification permission
        this.requestNotificationPermission();

        // Load saved
        const saved = localStorage.getItem('trackedTraders');
        if (saved) JSON.parse(saved).forEach(a => this.addTrader(a));

        // Start auto refresh every 30 seconds
        this.startAutoRefresh();
    }

    requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    sendNotification(title, body) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, {
                body,
                icon: '📊',
                tag: 'trader-update'
            });
        }
    }

    startAutoRefresh() {
        this.countdown = 30;
        setInterval(() => {
            this.countdown--;
            if (this.countdown <= 0) {
                this.refreshAll();
                this.countdown = 30;
            }
            const timerEl = document.getElementById('refreshTimer');
            if (timerEl) timerEl.textContent = this.countdown + 's';
        }, 1000);
    }

    async manualRefresh() {
        const btn = document.getElementById('manualRefreshBtn');
        btn.disabled = true;
        btn.textContent = '刷新中...';
        await this.refreshAll();
        this.countdown = 30;
        btn.disabled = false;
        btn.textContent = '🔄 刷新';
    }

    async refreshAll() {
        // Get current DOM order instead of Map order
        const items = document.querySelectorAll('.trader-item');
        for (const el of items) {
            const addr = el.dataset.address;
            const oldData = this.traders.get(addr);
            if (!oldData) continue;

            const newData = await this.fetchData(addr);

            // Detect position changes
            this.detectChanges(addr, oldData, newData);

            // Update data
            this.traders.set(addr, newData);

            // Re-render in place
            const parent = el.parentNode;
            const next = el.nextSibling;
            el.remove();
            this.renderAt(newData, parent, next);
        }
    }

    detectChanges(addr, oldData, newData) {
        const traderName = this.customNames[addr] || addr.slice(0,6) + '...' + addr.slice(-4);
        const oldPositions = new Map(oldData.positions.map(p => [p.asset + p.isLong, p]));
        const newPositions = new Map(newData.positions.map(p => [p.asset + p.isLong, p]));

        // Check for new positions (开仓)
        for (const [key, pos] of newPositions) {
            if (!oldPositions.has(key)) {
                const direction = pos.isLong ? '做多' : '做空';
                this.sendNotification(
                    `🟢 ${traderName} 开仓`,
                    `${pos.asset} ${direction} ${pos.leverage}x\n数量: ${pos.size.toFixed(4)}`
                );
            }
        }

        // Check for closed positions (平仓)
        for (const [key, pos] of oldPositions) {
            if (!newPositions.has(key)) {
                const direction = pos.isLong ? '做多' : '做空';
                this.sendNotification(
                    `🔴 ${traderName} 平仓`,
                    `${pos.asset} ${direction} 已平仓`
                );
            }
        }
    }

    async addTrader(address) {
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return;
        const addr = address.toLowerCase();
        if (this.traders.has(addr)) return;

        const data = await this.fetchData(addr);
        this.traders.set(addr, data);
        this.render(data);
        localStorage.setItem('trackedTraders', JSON.stringify([...this.traders.keys()]));
    }

    async fetchData(address) {
        try {
            const res = await fetch('https://api.hyperliquid.xyz/info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'clearinghouseState', user: address })
            });
            const data = await res.json();

            const positions = [];
            if (data.assetPositions) {
                for (const pos of data.assetPositions) {
                    const p = pos.position;
                    if (parseFloat(p.szi) === 0) continue;

                    const size = Math.abs(parseFloat(p.szi));
                    const isLong = parseFloat(p.szi) > 0;
                    const entry = parseFloat(p.entryPx);
                    const mark = parseFloat(p.positionValue) / size;
                    const pnl = parseFloat(p.unrealizedPnl);
                    const liq = parseFloat(p.liquidationPx) || 0;
                    const leverage = parseFloat(p.leverage?.value) || Math.round(parseFloat(p.positionValue) / parseFloat(p.marginUsed)) || 1;

                    positions.push({
                        asset: p.coin,
                        isLong,
                        leverage: Math.round(leverage),
                        size,
                        entry,
                        mark,
                        pnl,
                        liq,
                        value: Math.abs(parseFloat(p.positionValue))
                    });
                }
            }

            // Account summary
            const accountValue = parseFloat(data.marginSummary?.accountValue) || 0;
            const totalMarginUsed = parseFloat(data.marginSummary?.totalMarginUsed) || 0;
            const totalPositionValue = positions.reduce((sum, p) => sum + p.value, 0);
            const overallLeverage = accountValue > 0 ? totalPositionValue / accountValue : 0;

            return {
                address,
                name: address.slice(0,6) + '...' + address.slice(-4),
                positions,
                accountValue,
                overallLeverage
            };
        } catch (e) {
            console.error('API Error:', e);
            return { address, name: address.slice(0,6)+'...'+address.slice(-4), positions: [], accountValue: 0, overallLeverage: 0 };
        }
    }

    renderAt(data, parent, before) {
        const div = this.createTraderElement(data);
        if (before) {
            parent.insertBefore(div, before);
        } else {
            parent.appendChild(div);
        }
    }

    render(data) {
        const div = this.createTraderElement(data);
        document.getElementById('tradersList').appendChild(div);
    }

    createTraderElement(data) {
        const div = document.createElement('div');
        div.className = 'trader-item';
        div.dataset.address = data.address;
        div.draggable = true;

        // Drag events
        div.ondragstart = (e) => {
            div.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        };
        div.ondragend = () => {
            div.classList.remove('dragging');
            this.saveOrder();
        };
        div.ondragover = (e) => {
            e.preventDefault();
            const dragging = document.querySelector('.dragging');
            if (dragging && dragging !== div) {
                const list = document.getElementById('tradersList');
                const items = [...list.querySelectorAll('.trader-item:not(.dragging)')];
                const nextItem = items.find(item => {
                    const rect = item.getBoundingClientRect();
                    return e.clientY < rect.top + rect.height / 2;
                });
                if (nextItem) {
                    list.insertBefore(dragging, nextItem);
                } else {
                    list.appendChild(dragging);
                }
            }
        };

        const name = this.customNames[data.address] || data.name;
        const accountInfo = `$${data.accountValue.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} · ${data.overallLeverage.toFixed(2)}x`;

        let posRows = '';
        if (data.positions.length === 0) {
            posRows = `<tr><td class="account-cell">${accountInfo}</td><td colspan="7" style="color:#888">暂无持仓</td></tr>`;
        } else {
            posRows = data.positions.map((p, i) => {
                const typeClass = p.isLong ? 'type-long' : 'type-short';
                const pClass = p.pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
                return `<tr>
                    <td class="account-cell">${i === 0 ? accountInfo : ''}</td>
                    <td>${p.asset}</td>
                    <td class="${typeClass}">${p.isLong?'Long':'Short'} ${p.leverage}x</td>
                    <td>$${p.value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}<br><span style="color:#666;font-size:13px">${p.size.toFixed(4)} ${p.asset}</span></td>
                    <td class="${pClass}">${p.pnl>=0?'+':'-'}$${Math.abs(p.pnl).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                    <td>${this.fmtPrice(p.entry)}</td>
                    <td>${this.fmtPrice(p.mark)}</td>
                    <td class="liq-price">${this.fmtPrice(p.liq)}</td>
                </tr>`;
            }).join('');
        }

        div.innerHTML = `
            <table class="positions-table">
                <thead><tr>
                    <th class="th-info">
                        <span class="name" data-addr="${data.address}">${name}</span>
                        <span class="edit-btn">✏️</span>
                    </th>
                    <th>Asset</th>
                    <th>Type</th>
                    <th>Size</th>
                    <th>PnL</th>
                    <th>Entry</th>
                    <th>Mark</th>
                    <th class="th-actions">Liq.
                        <button class="history-btn">历史</button>
                        <a href="https://legacy.hyperdash.com/zh-CN/trader/${data.address}" target="_blank" class="link">详情</a>
                        <button class="remove-btn">×</button>
                    </th>
                </tr></thead>
                <tbody>${posRows}</tbody>
            </table>
        `;

        // Events
        div.querySelector('.edit-btn').onclick = () => this.editName(data.address, div.querySelector('.name'));
        div.querySelector('.remove-btn').onclick = () => this.remove(data.address);
        div.querySelector('.history-btn').onclick = () => this.showHistory(data.address);

        return div;
    }

    editName(addr, el) {
        const input = document.createElement('input');
        input.className = 'name-input';
        input.value = el.textContent;
        el.replaceWith(input);
        input.focus();
        input.select();

        const save = () => {
            const name = input.value.trim() || 'Trader';
            this.customNames[addr] = name;
            localStorage.setItem('traderCustomNames', JSON.stringify(this.customNames));
            const span = document.createElement('span');
            span.className = 'name';
            span.dataset.addr = addr;
            span.textContent = name;
            input.replaceWith(span);
            span.parentElement.querySelector('.edit-btn').onclick = () => this.editName(addr, span);
        };

        input.onblur = save;
        input.onkeydown = (e) => { if(e.key==='Enter') save(); if(e.key==='Escape') { input.replaceWith(el); }};
    }

    remove(addr) {
        this.traders.delete(addr);
        document.querySelector(`.trader-item[data-address="${addr}"]`)?.remove();
        this.saveOrder();
    }

    saveOrder() {
        const items = document.querySelectorAll('.trader-item');
        const order = [...items].map(item => item.dataset.address);
        localStorage.setItem('trackedTraders', JSON.stringify(order));
    }

    fmtPrice(v) {
        if(v>=1000) return '$'+v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
        if(v>=1) return '$'+v.toFixed(4);
        return '$'+v.toFixed(6);
    }

    async showHistory(address) {
        const list = document.getElementById('historyList');
        list.innerHTML = '<div style="text-align:center;color:#888;padding:20px">加载中...</div>';
        document.getElementById('historyModal').classList.add('show');

        try {
            const res = await fetch('https://api.hyperliquid.xyz/info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'userFills', user: address })
            });
            const fills = await res.json();

            if (!fills || fills.length === 0) {
                list.innerHTML = '<div style="text-align:center;color:#888;padding:20px">暂无交易记录</div>';
                return;
            }

            const trades = fills.slice(0, 20).map(f => ({
                asset: f.coin,
                isLong: f.side === 'B',
                size: parseFloat(f.sz),
                price: parseFloat(f.px),
                pnl: parseFloat(f.closedPnl) || 0,
                time: new Date(f.time),
                fee: parseFloat(f.fee),
                dir: f.dir
            }));

            list.innerHTML = trades.map(h => this.renderHistory(h)).join('');
        } catch (e) {
            console.error('History API Error:', e);
            list.innerHTML = '<div style="text-align:center;color:#f55;padding:20px">加载失败</div>';
        }
    }

    renderHistory(h) {
        const fmtDate = d => d.toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'})+' '+d.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
        const pnlClass = h.pnl>=0?'positive':'negative';
        const sideText = h.isLong ? '买入' : '卖出';
        return `
            <div class="history-item">
                <div class="history-header">
                    <div>
                        <div class="history-symbol">${h.asset}</div>
                        <div class="history-meta">${fmtDate(h.time)}</div>
                    </div>
                    <span class="history-side ${h.isLong?'long':'short'}">${sideText}</span>
                </div>
                <div class="history-grid">
                    <div class="hf"><span class="hl">价格</span><span>${this.fmtPrice(h.price)}</span></div>
                    <div class="hf"><span class="hl">数量</span><span>${h.size.toFixed(4)}</span></div>
                    <div class="hf"><span class="hl">手续费</span><span>$${h.fee.toFixed(4)}</span></div>
                    <div class="hf"><span class="hl">已实现盈亏</span><span class="${pnlClass}">${h.pnl>=0?'+':''}${h.pnl.toFixed(2)}</span></div>
                </div>
            </div>
        `;
    }
}

new TraderDashboard();
