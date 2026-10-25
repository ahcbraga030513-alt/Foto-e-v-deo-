# Foto em Vídeo com IA: passo a passo

Você precisa de 3 coisas: uma conta na fal.ai (a IA), uma conta na Cloudflare (o servidor, grátis) e o seu GitHub (o site). Os nomes dos botões podem variar um pouco.

## 1. fal.ai (a IA)
1. Crie uma conta em fal.ai e adicione crédito em dinheiro no menu de cobrança (Billing).
2. Vá em **Keys** e crie uma chave de API. Copie e guarde.
3. Custo do modelo usado: US$ 0,35 por vídeo de 5 s e US$ 0,70 por vídeo de 10 s.

## 2. Cloudflare (o servidor)
1. Crie uma conta grátis em cloudflare.com.
2. **Workers & Pages → Create → Create Worker**. Nome: `foto-em-video-api`. Toque em **Deploy**.
3. Toque em **Edit code**, apague tudo, cole o conteúdo do arquivo `worker.js` e toque em **Deploy**.
4. **Storage & Databases → KV → Create namespace**. Nome: `creditos`.
5. Volte ao Worker, vá em **Settings → Bindings → Add → KV namespace**. Em *Variable name* escreva `CREDITS` e escolha o namespace `creditos`.
6. Em **Settings → Variables and Secrets**, adicione:
   - `FAL_KEY` (tipo **Secret**): a chave da fal.ai.
   - `PASSCODE` (tipo **Secret**): uma senha que você inventa.
   - `ALLOWED_ORIGIN` (texto): `https://ahcbraga030513-alt.github.io`
   - `DAILY_LIMIT` (texto): `1000`
   - `GLOBAL_DAILY_CAP` (texto): `30` (máximo de vídeos por dia no servidor todo; protege seu dinheiro)
7. Toque em **Deploy** de novo e copie o endereço do Worker (termina em `workers.dev`).

## 3. GitHub (o site)
1. No repositório, abra o `index.html`, toque no lápis, apague tudo e cole o conteúdo do novo `index.html`. Confirme as alterações.
2. Espere 1 minuto e abra o site.

## 4. Primeiro uso
1. No site, abra **Configurar servidor**, cole o endereço do Worker e a senha, e toque em **Salvar configuração**.
2. Escolha a foto, escreva o que ela deve fazer e toque em **Gerar vídeo**.

## Segurança
- Nunca coloque a chave da fal.ai dentro do site. Ela fica só no Worker.
- Quem não tem a senha não consegue gerar vídeo.
