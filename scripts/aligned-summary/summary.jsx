      {/* Aligned Executive summary cards */}
      <div className="metrics-grid executive-summary-grid executive-cards-aligned">
        <div className="glass-panel metric-card accent-networth">
          <div className="metric-header"><span>{t('dash.portfolioValue')}</span><span className="metric-icon"><TrendingUp size={18} /></span></div>
          <div className="metric-value">{currencySymbol()}{money(summary.totalValue)}</div>
          <div className="metric-footer">
            {summary.sealed && summary.sealed.remainingUnits > 0 && (summary.sealed.marketValue > 0 || summary.sealed.valuationComplete) && <div>{t('dash.sealedIncluded', { value: `${currencySymbol()}${money(summary.sealed.marketValue)}` })}</div>}
            {summary.sealed && summary.sealed.unpricedUnits > 0 && <div className="summary-pricing-warning">{t('dash.sealedUnpriced', { count: summary.sealed.unpricedUnits })}</div>}
          </div>
        </div>

        <div className="glass-panel metric-card accent-invested">
          <div className="metric-header"><span title={t('dash.investedHint')}>{t('dash.totalInvested')}</span><span className="metric-icon"><Coins size={18} /></span></div>
          <div className="metric-value">{currencySymbol()}{money(summary.totalSpent)}</div>
          <div className="metric-footer" title="Total recorded card and sealed spending divided by currently owned physical card copies; includes sealed purchases.">{t('dash.avgInvestedShort', { price: priceText(cardAverages(summary).investedPerCard, summary.currency || reportingCurrency) })}</div>
        </div>

        {(() => {
          const roi = summary.roi || { abs: 0, pct: null };
          const isPositive = (roi.abs || 0) >= 0;
          return <div className={`glass-panel metric-card ${isPositive ? 'accent-gain-up' : 'accent-gain-down'}`}>
            <div className="metric-header"><span>{t('dash.unrealizedGain')}</span><span className="metric-icon"><ArrowUpRight size={18} style={{ transform: isPositive ? 'none' : 'rotate(90deg)' }} /></span></div>
            <div className="metric-value" style={{ color: isPositive ? '#22c55e' : '#ef4444' }}>{isPositive ? '+' : '−'}{currencySymbol()}{money(Math.abs(roi.abs || 0))}</div>
            <div className="metric-footer">{roi.pct === null ? t('dash.roiUnset') : t('dash.roiVsCost', { pct: `${isPositive ? '+' : ''}${roi.pct}` })}</div>
          </div>;
        })()}

        <div className="glass-panel metric-card" aria-label="Realized Loss/Gain pending sales integration">
          <div className="metric-header"><span>{t('dash.realizedLossGain')}</span><span className="metric-icon"><Coins size={18} /></span></div>
          <div className="metric-value" style={{ color: 'var(--text-muted)' }} aria-label="Not available">—</div>
          <div className="metric-footer">{t('dash.realizedPending')}</div>
        </div>

        <div className="glass-panel metric-card accent-cards">
          <div className="metric-header"><span>{t('dash.totalCards')}</span><span className="metric-icon"><Library size={18} /></span></div>
          <div className="metric-value">{summary.totalCards}</div>
          <div className="metric-footer">
            <div>{t('dash.uniqueCount', { count: summary.uniqueCards })}{summary.unsortedCount > 0 ? ` · ${t('dash.unsortedCount', { count: summary.unsortedCount })}` : ''}</div>
            <div>{t('dash.avgMarketShort', { price: priceText(cardAverages(summary).marketPerCard, summary.currency || reportingCurrency) })}</div>
          </div>
        </div>
      </div>

