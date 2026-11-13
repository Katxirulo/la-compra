# La compra

Lista de la compra compartida y sincronizada en tiempo real. Es una PWA estática (se instala en el móvil como una app) alojada en **GitHub Pages**, con **Supabase** como base de datos y sincronización.

## Funciones (v1)

- Lista común: lo que apunta uno lo ven todos al instante.
- Habituales con un toque: cada producto que se añade pasa a «Habituales», ordenados por uso.
- Marcar como comprado («En el carro») y quitar los comprados de golpe.
- Invitar por enlace o código de 6 caracteres. Sin contraseñas: cada dispositivo usa una sesión anónima.
- Funciona sin conexión para abrirla; los cambios se sincronizan al volver la red.

## Puesta en marcha

### 1. Supabase (gratis)
1. Crea un proyecto en https://supabase.com (región UE, p. ej. Frankfurt o París).
2. **Authentication → Sign In / Providers → Anonymous sign-ins**: actívalo.
3. **SQL Editor → New query**: pega el contenido de `schema.sql` y ejecútalo.
4. **Project Settings → API**: copia la *Project URL* y la clave *anon / publishable* en `config.js`.

> La clave anon/publishable es pública por diseño; la seguridad la ponen las políticas RLS: solo los miembros de un hogar ven y modifican sus datos. No pongas nunca la clave `service_role`/`secret` en el frontend.

### 2. GitHub
```bash
git init
git add .
git commit -m "La compra v1"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/la-compra.git
git push -u origin main
```
Después: **Settings → Pages → Source: Deploy from a branch → main / root**. En un par de minutos estará en `https://TU-USUARIO.github.io/la-compra/`.

### 3. Usarla
1. Abre la URL, escribe tu nombre y crea la lista.
2. Pulsa **Invitar** y comparte el enlace por WhatsApp.
3. En el móvil: *Añadir a pantalla de inicio* (Safari) o *Instalar app* (Chrome).

## Notas

- **Pausa por inactividad**: en el plan gratuito, Supabase pausa los proyectos sin actividad durante una semana. Con uso semanal normal no debería pasar; si ocurre, se reactiva desde el panel.
- **Sesión por dispositivo**: si se borran los datos del navegador, basta con volver a unirse con el código.
- **Actualizaciones**: si cambias ficheros, sube `CACHE` en `sw.js` (p. ej. `compra-v2`) para forzar la recarga en los móviles.

## Estructura

| Fichero | Uso |
|---|---|
| `index.html` | Interfaz |
| `styles.css` | Estilos (tema claro/oscuro automático) |
| `app.js` | Lógica y sincronización con Supabase |
| `config.js` | URL y clave de tu proyecto |
| `schema.sql` | Tablas, seguridad RLS, funciones y tiempo real |
| `sw.js`, `manifest.webmanifest`, `icons/` | Instalación como app (PWA) |
