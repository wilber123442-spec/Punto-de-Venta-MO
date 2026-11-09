(() => {
  let syncBusy = false;
  const status = message => {
    const node = document.getElementById('cloudSyncStatus');
    if (node) node.textContent = message;
  };
  const uuid = () => crypto.randomUUID();
  const readMap = key => {
    try { return JSON.parse(localStorage.getItem(key) || '{}'); }
    catch { return {}; }
  };
  const writeMap = (key, map) => localStorage.setItem(key, JSON.stringify(map));

  function localNumericId(mapKey, cloudId, currentItems) {
    const map = readMap(mapKey);
    if (map[cloudId]) return map[cloudId];
    const used = new Set((currentItems || []).map(item => Number(item.id)).filter(Number.isFinite));
    let id = Math.max(Date.now(), Number(localStorage.getItem('mn_cloud_id_counter') || 0));
    while (used.has(id)) id++;
    localStorage.setItem('mn_cloud_id_counter', String(id + 1));
    map[cloudId] = id;
    writeMap(mapKey, map);
    return id;
  }

  function cloudContext() {
    const businessId = businessProfile?.cloudBusinessId;
    if (!businessId || !window.miCajaCloud?.connected) return null;
    return { businessId, client: window.miCajaCloud };
  }

  function saveLocalState() {
    localStorage.setItem('mn_products', JSON.stringify(products));
    localStorage.setItem('mn_sales', JSON.stringify(sales));
    if (typeof render === 'function') render();
    if (typeof renderSalesHistory === 'function') renderSalesHistory();
  }

  async function seedCloudCatalog(context) {
    if (currentUser?.role !== 'admin') throw new Error('Solo el administrador puede cargar el inventario inicial.');
    const businessId = context.businessId;
    const productRows = [];
    for (const product of products) {
      product.cloudId ||= uuid();
      product.cloudDirty = true;
      normalizeProductLots(product);
      productRows.push({
        id: product.cloudId,
        business_id: businessId,
        name: product.name,
        barcode: product.barcode || null,
        unit_price: Number(product.price),
        purchase_price: averageKnownCost(product),
        stock_quantity: 0,
        active: true
      });
    }
    localStorage.setItem('mn_products', JSON.stringify(products));
    if (productRows.length) await context.client.upsert('products', productRows);

    for (const product of products) {
      for (const lot of product.batches || []) {
        if (!(Number(lot.quantity) > 0)) continue;
        lot.cloudId ||= uuid();
        lot.cloudPending = true;
        localStorage.setItem('mn_products', JSON.stringify(products));
        await context.client.rpc('add_inventory_lot', {
          p_business_id: businessId,
          p_product_id: product.cloudId,
          p_lot_id: lot.cloudId,
          p_lot_number: lot.lotNumber || '',
          p_expires_on: lot.expiryDate || null,
          p_quantity: Number(lot.quantity),
          p_unit_cost: lot.costPrice == null || lot.costPrice === '' ? null : Number(lot.costPrice)
        });
        lot.cloudPending = false;
      }
      product.cloudDirty = false;
      localStorage.setItem('mn_products', JSON.stringify(products));
    }
  }

  async function syncDirtyCatalog(context) {
    if (currentUser?.role !== 'admin') return;
    const deleted = JSON.parse(localStorage.getItem('mn_cloud_deleted_products') || '[]');
    for (const cloudId of deleted) {
      await context.client.update('products', {
        id: `eq.${cloudId}`, business_id: `eq.${context.businessId}`
      }, { active: false });
    }
    if (deleted.length) localStorage.removeItem('mn_cloud_deleted_products');

    for (const product of products) {
      const hasPendingLots = (product.batches || []).some(lot =>
        Number(lot.quantity) > 0 && (lot.cloudPending || !lot.cloudId)
      );
      if (!product.cloudDirty && product.cloudId && !hasPendingLots) continue;
      const isNew = !product.cloudId;
      product.cloudId ||= uuid();
      const row = {
        id: product.cloudId,
        business_id: context.businessId,
        name: product.name,
        barcode: product.barcode || null,
        unit_price: Number(product.price),
        purchase_price: averageKnownCost(product),
        active: true
      };
      if (isNew) row.stock_quantity = 0;
      await context.client.upsert('products', [row]);
      product.cloudDirty = false;

      for (const lot of product.batches || []) {
        if (!(Number(lot.quantity) > 0) || (lot.cloudId && !lot.cloudPending)) continue;
        lot.cloudId ||= uuid();
        lot.cloudPending = true;
        await context.client.rpc('add_inventory_lot', {
          p_business_id: context.businessId,
          p_product_id: product.cloudId,
          p_lot_id: lot.cloudId,
          p_lot_number: lot.lotNumber || '',
          p_expires_on: lot.expiryDate || null,
          p_quantity: Number(lot.quantity),
          p_unit_cost: lot.costPrice == null || lot.costPrice === '' ? null : Number(lot.costPrice)
        });
        lot.cloudPending = false;
      }
      localStorage.setItem('mn_products', JSON.stringify(products));
    }
  }

  async function pullCloudData(context) {
    const businessId = context.businessId;
    const remoteProducts = await context.client.select('products', {
      select: 'id,name,barcode,unit_price,purchase_price,stock_quantity,active',
      business_id: `eq.${businessId}`, active: 'eq.true', order: 'name.asc', limit: '1000'
    });
    if (!remoteProducts.length) return false;

    const remoteLots = await context.client.select('product_lots', {
      select: 'id,product_id,lot_number,expires_on,quantity,unit_cost',
      business_id: `eq.${businessId}`, quantity: 'gt.0', order: 'expires_on.asc', limit: '5000'
    });
    const lotsByProduct = new Map();
    for (const lot of remoteLots) {
      const list = lotsByProduct.get(lot.product_id) || [];
      list.push({
        id: lot.id,
        cloudId: lot.id,
        cloudSynced: true,
        lotNumber: lot.lot_number || '',
        expiryDate: lot.expires_on || '',
        quantity: Number(lot.quantity || 0),
        costPrice: lot.unit_cost == null ? null : Number(lot.unit_cost)
      });
      lotsByProduct.set(lot.product_id, list);
    }

    const dirtyLocal = products.filter(product => product.cloudDirty);
    const remoteIdMap = new Map(remoteProducts.map(product => [product.id, product]));
    const mergedProducts = remoteProducts.map(product => {
      const local = products.find(item => item.cloudId === product.id);
      return normalizeProductLots({
        id: local?.id ?? localNumericId('mn_cloud_product_ids', product.id, products),
        cloudId: product.id,
        cloudDirty: false,
        name: product.name,
        barcode: product.barcode || '',
        price: Number(product.unit_price),
        costPrice: product.purchase_price == null ? null : Number(product.purchase_price),
        stock: Number(product.stock_quantity || 0),
        batches: lotsByProduct.get(product.id) || []
      });
    });
    for (const local of dirtyLocal) {
      if (!local.cloudId || !remoteIdMap.has(local.cloudId)) mergedProducts.push(local);
    }
    products = mergedProducts;

    const remoteSales = await context.client.select('sales', {
      select: '*', business_id: `eq.${businessId}`, order: 'sold_at.desc', limit: '1000'
    });
    const saleIds = remoteSales.map(sale => sale.id);
    const remoteItems = saleIds.length ? await context.client.select('sale_items', {
      select: '*', business_id: `eq.${businessId}`,
      sale_id: `in.(${saleIds.join(',')})`, order: 'created_at.asc', limit: '5000'
    }) : [];
    const itemsBySale = new Map();
    for (const item of remoteItems) {
      const list = itemsBySale.get(item.sale_id) || [];
      const product = products.find(row => row.cloudId === item.product_id);
      list.push({
        id: product?.id ?? null,
        cloudProductId: item.product_id,
        name: item.product_name,
        price: Number(item.unit_price),
        qty: Number(item.quantity),
        costPrice: item.unit_cost == null ? null : Number(item.unit_cost),
        grossProfit: item.gross_profit == null ? null : Number(item.gross_profit),
        batchAllocations: (item.lot_allocations || []).map(a => ({
          batchId: a.batchId, cloudBatchId: a.batchId,
          quantity: Number(a.quantity), costPrice: a.costPrice == null ? null : Number(a.costPrice)
        }))
      });
      itemsBySale.set(item.sale_id, list);
    }
    const pendingLocal = sales.filter(sale => sale.cloudPending || (sale.voided && !sale.cloudVoided));
    const remoteLocal = remoteSales.map(sale => ({
      id: localNumericId('mn_cloud_sale_ids', sale.id, sales),
      cloudId: sale.id,
      cloudSynced: true,
      cloudVoided: Boolean(sale.voided_at),
      date: String(sale.sold_at || '').slice(0, 10),
      time: sale.sold_at,
      currency: sale.currency_code || currency,
      subtotal: Number(sale.subtotal || 0),
      total: Number(sale.total || 0),
      payment: sale.payment_method,
      seller: sale.seller_name,
      sellerUserId: sale.seller_user_id,
      voided: Boolean(sale.voided_at),
      voidedAt: sale.voided_at,
      voidReason: sale.void_reason || '',
      items: itemsBySale.get(sale.id) || []
    }));
    const remoteIds = new Set(remoteSales.map(sale => sale.id));
    const localOnly = sales.filter(sale =>
      (sale.cloudPending || (!currentUser?.cloudAuth && !sale.cloudId)) &&
      (!sale.cloudId || !remoteIds.has(sale.cloudId))
    );
    sales = [...pendingLocal, ...remoteLocal, ...localOnly.filter(sale => !pendingLocal.includes(sale))];
    saveLocalState();
    return true;
  }

  async function syncCloudSales(context) {
    if (!context) return;
    for (const sale of sales) {
      if (sale.cloudPending && String(sale.sellerUserId || '') !== String(context.client.userId || '')) continue;
      if (!sale.cloudPending && !(sale.voided && sale.cloudSynced && !sale.cloudVoided)) continue;
      sale.cloudId ||= uuid();
      if (sale.cloudPending) {
        const items = (sale.items || []).map(item => {
          const product = products.find(row => String(row.id) === String(item.id));
          if (!product?.cloudId) throw new Error(`Falta sincronizar el producto “${item.name}”.`);
          return {
            product_id: product.cloudId,
            quantity: Number(item.qty),
            unit_price: Number(item.price)
          };
        });
        await context.client.rpc('record_sale', {
          p_sale_id: sale.cloudId,
          p_business_id: context.businessId,
          p_items: items,
          p_payment_method: sale.payment || 'Efectivo',
          p_currency_code: sale.currency || currency,
          p_sold_at: sale.time || new Date().toISOString(),
          p_device_id: context.client.deviceId
        });
        sale.cloudPending = false;
        sale.cloudSynced = true;
        localStorage.setItem('mn_sales', JSON.stringify(sales));
      }
      if (sale.voided && sale.cloudSynced && !sale.cloudVoided) {
        await context.client.rpc('void_sale', {
          p_business_id: context.businessId,
          p_sale_id: sale.cloudId,
          p_reason: sale.voidReason || 'Anulada en el punto de venta'
        });
        sale.cloudVoided = true;
        localStorage.setItem('mn_sales', JSON.stringify(sales));
      }
    }
  }

  async function syncCloudNow(options = {}) {
    const context = cloudContext();
    if (!context) {
      status('Inicia sesión con una cuenta en la nube para sincronizar.');
      return false;
    }
    if (syncBusy) return false;
    syncBusy = true;
    const headerButton = document.getElementById('cloudSyncHeader');
    const settingsButton = document.getElementById('cloudSyncNow');
    [headerButton, settingsButton].filter(Boolean).forEach(button => { button.disabled = true; });
    status('Sincronizando…');
    try {
      if (options.flushOnly) {
        await syncDirtyCatalog(context);
        await syncCloudSales(context);
        await pullCloudData(context);
        status('Ventas pendientes enviadas y catálogo actualizado.');
        return true;
      }
      let remoteProducts = await context.client.select('products', {
        select: 'id', business_id: `eq.${context.businessId}`, active: 'eq.true', limit: '1'
      });
      if (!remoteProducts.length && currentUser?.role === 'admin' && products.length) {
        if (options.allowSeed === false) {
          status('El catálogo de la nube está vacío. El administrador puede cargar aquí el inventario inicial.');
          return false;
        }
        if (!options.silent && !confirm('La nube está vacía. Se cargarán los productos, lotes y existencias guardados en esta computadora. ¿Continuar?')) {
          status('No se hicieron cambios en la nube.');
          return false;
        }
        await seedCloudCatalog(context);
        remoteProducts = await context.client.select('products', {
          select: 'id', business_id: `eq.${context.businessId}`, active: 'eq.true', limit: '1'
        });
      } else {
        await syncDirtyCatalog(context);
      }
      await syncCloudSales(context);
      const hasCatalog = await pullCloudData(context);
      status(hasCatalog
        ? `Sincronización lista · ${products.length} productos · ${sales.filter(s => s.cloudSynced).length} ventas en la nube.`
        : 'Conexión lista. El catálogo está vacío; carga el inventario inicial desde la computadora administradora.');
      return true;
    } catch (error) {
      status(`Quedaron datos locales pendientes: ${error.message || 'No se pudo sincronizar.'}`);
      return false;
    } finally {
      syncBusy = false;
      [headerButton, settingsButton].filter(Boolean).forEach(button => { button.disabled = false; });
    }
  }

  window.syncCloudNow = syncCloudNow;
  window.syncCloudSales = () => syncCloudSales(cloudContext());
  window.syncCloudCatalog = () => {
    const context = cloudContext();
    return context ? syncDirtyCatalog(context) : Promise.resolve();
  };
  window.pullCloudData = () => {
    const context = cloudContext();
    return context ? pullCloudData(context) : Promise.resolve(false);
  };
  window.addEventListener('online', () => {
    if (cloudContext()) void syncCloudNow({ silent: true, allowSeed: false });
  });
  window.setInterval(() => {
    if (!document.hidden && cloudContext()) void syncCloudNow({ silent: true, allowSeed: false });
  }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && cloudContext()) void syncCloudNow({ silent: true, allowSeed: false });
  });
})();

