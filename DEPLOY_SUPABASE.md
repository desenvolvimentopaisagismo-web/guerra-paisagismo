# Implantação da versão em nuvem

Esta versão funciona em dois modos:

1. **Local/offline** — funciona mesmo sem Supabase configurado.
2. **Híbrido offline + nuvem** — após configurar Supabase, permite login e sincronização.

## 1. Criar o projeto Supabase

Crie um projeto no Supabase e copie:
- Project URL
- Publishable/anon key

Não coloque `service_role` no aplicativo.

## 2. Criar o banco

Abra o SQL Editor do projeto e execute `supabase_schema.sql`.

Depois:
1. crie a organização `Guerra Paisagismo`;
2. crie os usuários em Authentication;
3. cadastre cada usuário na tabela `profiles`;
4. use `manager` para gestor e `seller` para vendedor.

## 3. Configurar o aplicativo

Edite `config.js`:

```js
window.GP_CONFIG = {
  SUPABASE_URL: "https://SEU-PROJETO.supabase.co",
  SUPABASE_ANON_KEY: "SUA_CHAVE_PUBLICA",
  STORAGE_BUCKET: "visit-photos"
};
```

## 4. Hospedar

Hospede toda a pasta em HTTPS. Exemplos de hosts compatíveis:
- Netlify
- Vercel
- GitHub Pages
- servidor próprio

Depois, no celular, abra o endereço e use **Adicionar à Tela de Início**.

## 5. Fluxo de uso

- O vendedor trabalha normalmente mesmo sem internet.
- A visita é salva primeiro no aparelho.
- Ao recuperar conexão, abre **Nuvem > Sincronizar agora**.
- O gestor entra com sua conta e baixa as visitas da organização.
- Fotos ficam em bucket privado e são abertas por URLs temporárias assinadas.

## Segurança

- O aplicativo usa autenticação Supabase.
- As tabelas usam RLS.
- O vendedor só pode alterar registros próprios, enquanto o gestor pode alterar visitas da mesma organização.
- Fotos ficam em bucket privado.
- Nunca coloque a `service_role` no front-end.

## Observação sobre conflitos

Esta versão usa estratégia simples de “última atualização enviada” por visita. Para uma equipe maior, a próxima evolução recomendada é registrar eventos de auditoria e versionamento de conflitos por campo.
