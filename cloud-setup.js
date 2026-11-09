(() => {
  const statusNode = () => document.getElementById('cloudAccountStatus');

  function showStatus(message, error = false) {
    const node = statusNode();
    if (!node) return;
    node.textContent = message;
    node.style.color = error ? 'var(--red)' : 'var(--muted)';
  }

  function businessCode(name) {
    const slug = String(name || 'mi-negocio').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'negocio';
    return `${slug}-${crypto.randomUUID().slice(0, 8)}`;
  }

  function saveCloudBusiness(businessId, userId, member) {
    if (!businessProfile?.cloudBusinessId) {
      localStorage.setItem('mn_cloud_prelink_backup', JSON.stringify({
        businessName: businessProfile?.name || '', products, sales
      }));
    }
    businessProfile = {
      ...(businessProfile || {}),
      cloudBusinessId: businessId,
      cloudUserId: userId,
      cloudUsername: member.username,
      cloudRole: member.role
    };
    localStorage.setItem('mn_business_profile', JSON.stringify(businessProfile));
    currentUser = {
      ...currentUser,
      cloudUserId: userId,
      cloudBusinessId: businessId,
      cloudRole: member.role
    };
    sessionStorage.setItem('mn_current_user', JSON.stringify(currentUser));
    const localAccount = accounts.find(account => account.id === currentUser.id);
    if (localAccount) {
      localAccount.cloudUserId = userId;
      localAccount.cloudBusinessId = businessId;
      localAccount.cloudRole = member.role;
      localStorage.setItem('mn_accounts', JSON.stringify(accounts));
    }
  }

  async function syncCloudBusinessSettings() {
    if (!businessProfile?.cloudBusinessId || !window.miCajaCloud?.connected || currentUser?.role !== 'admin') return;
    const businessRows = await window.miCajaCloud.update('businesses', {
      id: `eq.${businessProfile.cloudBusinessId}`
    }, { name: businessProfile.name, currency_code: currency });
    if (!businessRows?.length) throw new Error('No se guardó la configuración del negocio en la nube.');
    await window.miCajaCloud.upsert('business_settings', [{
      business_id: businessProfile.cloudBusinessId,
      address: printSettings.address || '',
      phone: printSettings.phone || '',
      tax_id: printSettings.taxId || '',
      receipt_footer: printSettings.footer || '¡Gracias por su compra!',
      paper_width: Number(printSettings.width || 58)
    }], 'business_id');
  }

  async function sha256Hex(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function makeInvitationToken() {
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    const code = Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
    return `mc-${code.slice(0, 5)}-${code.slice(5)}`;
  }

  async function authenticateCloudLogin(mode) {
    const email = document.getElementById('cloudLoginEmail').value.trim();
    const password = document.getElementById('cloudLoginPassword').value;
    const rawToken = document.getElementById('cloudInviteToken').value.trim().toLowerCase();
    if (!email || !email.includes('@') || password.length < 8) {
      toast('Escribe un correo válido y una contraseña de al menos 8 caracteres.');
      return;
    }
    if (mode === 'signup' && !/^mc-[a-hj-np-z2-9]{5}-[a-hj-np-z2-9]{5}$/.test(rawToken)) {
      toast('Pega la invitación corta que te dio el administrador.');
      return;
    }
    try {
      const auth = mode === 'signup'
        ? await window.miCajaCloud.signUp(email, password)
        : await window.miCajaCloud.signIn(email, password);
      if (!window.miCajaCloud.connected) {
        toast('Revisa el correo para confirmar la cuenta y luego inicia sesión con el código de invitación.');
        return;
      }
      if (rawToken) {
        await window.miCajaCloud.rpc('accept_business_invitation', { p_token_hash: await sha256Hex(rawToken) });
      }
      const userId = auth?.user?.id || window.miCajaCloud.userId;
      const memberships = await window.miCajaCloud.select('business_members', {
        select: 'business_id,username,display_name,role,active',
        user_id: `eq.${userId}`, active: 'eq.true', limit: '10'
      });
      const member = memberships[0];
      if (!member) throw new Error('Esta cuenta aún no pertenece a un negocio. Pide una invitación al administrador.');
      const businesses = await window.miCajaCloud.select('businesses', {
        select: 'id,name,currency_code', id: `eq.${member.business_id}`, limit: '1'
      });
      const business = businesses[0];
      if (!business) throw new Error('No encontré el negocio asociado a esta cuenta.');
      const settings = await window.miCajaCloud.select('business_settings', {
        select: 'address,phone,tax_id,receipt_footer,paper_width',
        business_id: `eq.${business.id}`, limit: '1'
      });

      if (!businessProfile?.cloudBusinessId) {
        localStorage.setItem('mn_cloud_prelink_backup', JSON.stringify({
          businessName: businessProfile?.name || '', products, sales
        }));
      }
      businessProfile = {
        ...(businessProfile || {}),
        name: business.name,
        cloudBusinessId: business.id,
        cloudUserId: userId,
        cloudUsername: member.username,
        cloudRole: member.role
      };
      currency = business.currency_code || currency;
      localStorage.setItem('mn_currency', currency);
      localStorage.setItem('mn_business_profile', JSON.stringify(businessProfile));
      printSettings = { ...printSettings, business: business.name };
      if (settings[0]) {
        printSettings = {
          ...printSettings,
          address: settings[0].address || '',
          phone: settings[0].phone || '',
          taxId: settings[0].tax_id || '',
          footer: settings[0].receipt_footer || printSettings.footer,
          width: Number(settings[0].paper_width || 58)
        };
      }
      localStorage.setItem('mn_print_settings', JSON.stringify(printSettings));
      const localAccount = accounts.find(account => account.username === member.username &&
        (!account.cloudBusinessId || account.cloudBusinessId === business.id));
      if (localAccount) {
        localAccount.cloudUserId = userId;
        localAccount.cloudBusinessId = business.id;
        localAccount.cloudRole = member.role;
        localStorage.setItem('mn_accounts', JSON.stringify(accounts));
      }
      currentUser = {
        id: userId,
        name: member.display_name,
        username: member.username,
        role: member.role === 'cashier' ? 'cashier' : 'admin',
        cloudAuth: true,
        cloudUserId: userId,
        cloudBusinessId: business.id
      };
      sessionStorage.setItem('mn_current_user', JSON.stringify(currentUser));
      document.getElementById('cloudLoginPassword').value = '';
      document.getElementById('cloudInviteToken').value = '';
      document.getElementById('authModal').classList.remove('open');
      initAuth();
      toast(`Sesión iniciada para ${business.name}.`);
      if (window.syncCloudNow) void window.syncCloudNow({ silent: true, allowSeed: false });
    } catch (error) {
      toast(error.message || 'No se pudo iniciar sesión en la nube.');
    }
  }

  async function createCloudInvitation() {
    if (currentUser?.role !== 'admin' || !businessProfile?.cloudBusinessId || !window.miCajaCloud?.connected) {
      toast('Vincula primero la cuenta del administrador con el negocio en la nube.');
      return;
    }
    const name = document.getElementById('cloudInviteName').value.trim();
    const username = document.getElementById('cloudInviteUsername').value.trim().toLowerCase();
    const email = document.getElementById('cloudInviteEmail').value.trim().toLowerCase();
    const role = document.getElementById('cloudInviteRole').value;
    if (!name || username.length < 2 || !email.includes('@')) {
      toast('Completa nombre, usuario y correo del cajero.');
      return;
    }
    try {
      const token = makeInvitationToken();
      await window.miCajaCloud.rpc('create_business_invitation', {
        p_email: email,
        p_username: username,
        p_display_name: name,
        p_role: role,
        p_token_hash: await sha256Hex(token)
      });
      document.getElementById('cloudInviteTokenResult').value = token.toUpperCase();
      document.getElementById('cloudInviteResult').style.display = 'block';
      toast('Invitación creada. Comparte el código con el cajero.');
    } catch (error) {
      toast(error.message || 'No se pudo crear la invitación.');
    }
  }

  async function copyCloudInvitation() {
    const token = document.getElementById('cloudInviteTokenResult').value;
    try {
      await navigator.clipboard.writeText(token);
      toast('Código copiado. Envíalo al cajero por un medio seguro.');
    } catch {
      document.getElementById('cloudInviteTokenResult').select();
      toast('Seleccioné el código. Cópialo con Ctrl+C.');
    }
  }

  async function connectCloudAccount(mode) {
    if (currentUser?.role !== 'admin') {
      showStatus('Solo el administrador local puede vincular el negocio.', true);
      return;
    }
    const email = document.getElementById('cloudAdminEmail').value.trim();
    const password = document.getElementById('cloudAdminPassword').value;
    if (!email || !email.includes('@') || password.length < 8) {
      showStatus('Escribe un correo válido y una contraseña de al menos 8 caracteres.', true);
      return;
    }
    const buttons = [...document.querySelectorAll('#settingsContent button[onclick^="connectCloudAccount"]')];
    buttons.forEach(button => { button.disabled = true; });
    showStatus('Conectando con Supabase…');
    try {
      await window.miCajaCloud.checkConnection();
      let auth;
      if (mode === 'create') {
        auth = await window.miCajaCloud.signUp(email, password);
        if (!window.miCajaCloud.connected) {
          showStatus('Cuenta creada. Confirma el correo que envió Supabase y luego vincula la cuenta existente.');
          return;
        }
      } else {
        auth = await window.miCajaCloud.signIn(email, password);
      }

      const userId = auth?.user?.id || window.miCajaCloud.userId;
      if (!userId) throw new Error('Supabase no devolvió una sesión activa.');
      let memberships = await window.miCajaCloud.select('business_members', {
        select: 'business_id,username,display_name,role,active',
        user_id: `eq.${userId}`, active: 'eq.true', limit: '10'
      });
      let member = memberships.find(item => item.role === 'owner' || item.role === 'admin');
      let businessId = member?.business_id;

      if (!businessId && memberships.length) {
        throw new Error('Esta cuenta de nube no tiene permisos de administrador para vincular el negocio.');
      }
      if (!businessId) {
        const ownerName = currentUser.name || currentUser.username || 'Administrador';
        let username = String(currentUser.username || 'admin').toLowerCase()
          .replace(/[^a-z0-9._-]/g, '').slice(0, 60) || 'admin';
        if (username.length < 2) username = 'admin';
        businessId = await window.miCajaCloud.rpc('create_business_with_owner', {
          p_name: businessProfile?.name || 'Mi Negocio',
          p_business_code: businessCode(businessProfile?.name),
          p_owner_username: username,
          p_owner_display_name: ownerName
        });
        const updated = await window.miCajaCloud.update('businesses', { id: `eq.${businessId}` }, { currency_code: currency });
        if (!updated?.length) throw new Error('El negocio se creó, pero no pude guardar su moneda. Vuelve a vincular la cuenta.');
        member = { business_id: businessId, username, display_name: ownerName, role: 'owner', active: true };
      }

      saveCloudBusiness(businessId, userId, member);
      try { await syncCloudBusinessSettings(); } catch (error) { showStatus(error.message, true); }
      document.getElementById('cloudAdminPassword').value = '';
      showStatus(`Cuenta vinculada al negocio “${businessProfile?.name || 'Mi Negocio'}”. La sincronización inicial de productos requiere confirmación desde el botón Sincronizar.`);
      if (window.syncCloudNow) void window.syncCloudNow({ silent: true, allowSeed: false });
    } catch (error) {
      showStatus(error.message || 'No se pudo vincular la cuenta.', true);
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  window.connectCloudAccount = connectCloudAccount;
  window.authenticateCloudLogin = authenticateCloudLogin;
  window.createCloudInvitation = createCloudInvitation;
  window.copyCloudInvitation = copyCloudInvitation;
  window.syncCloudBusinessSettings = syncCloudBusinessSettings;
  if (typeof window.logout === 'function') {
    const originalLogout = window.logout;
    window.logout = function () {
      const result = originalLogout();
      void window.miCajaCloud?.signOut().catch(() => {});
      return result;
    };
  }
  window.refreshCloudAccountStatus = () => {
    if (businessProfile?.cloudBusinessId) {
      showStatus(window.miCajaCloud?.connected
        ? `Cuenta en la nube vinculada al negocio “${businessProfile.name || 'Mi Negocio'}”.`
        : `Negocio vinculado a la nube. Inicia sesión en la nube para renovar el acceso.`);
    }
  };
  window.refreshCloudAccountStatus();
})();

