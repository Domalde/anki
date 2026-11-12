# Meu Anki

Flashcards com repetição espaçada que rodam no navegador. Não precisa de servidor, cadastro nem chave de API.

## O que ele faz
- **Estudar**: mostra a frase, toca o áudio, você revela a resposta e escolhe Errei, Difícil, Bom ou Fácil. O algoritmo é o SM-2, o mesmo tipo do Anki.
  - Atalhos: `espaço` mostra a resposta e depois marca "Bom", `1` a `4` dão a nota, `P` toca o áudio.
- **Adicionar**: você digita a frase e a tradução sai sozinha (botão 🌐, ou automaticamente se o campo ficar vazio).
- **Em lote**: cole várias frases, uma por linha, e todas são traduzidas e viram cartas.
- **Do áudio**: envie um áudio ou vídeo (podcast, música, mensagem de voz). O app transcreve com o **Whisper**, que roda no próprio navegador, divide o texto em frases e cria uma carta por frase, cada uma com o **recorte do áudio original** e a tradução. Na primeira vez ele baixa o modelo (40 a 250 MB, conforme a qualidade escolhida) e depois fica em cache.
- **Exemplo automático** (inglês): digite uma palavra e clique em 💡. O app busca uma frase de exemplo e a definição.
- **Backup**: exporte e importe um arquivo `.json`, que inclui os áudios gravados.

## De onde vem o áudio (tudo grátis)
| Opção | Como funciona | Observação |
|---|---|---|
| **Voz automática (padrão)** | Usa a voz "Natural"/"Online" do navegador, se houver uma no idioma; se não houver, usa a voz online do Google Tradutor | Sempre com sotaque nativo, mesmo que o Windows só tenha vozes em português. Sem internet, usa uma voz instalada no Windows |
| **Pronúncia do dicionário** | Para palavras soltas em inglês, usa o MP3 do [dictionaryapi.dev](https://dictionaryapi.dev) gravado por pessoas | Automático quando a carta tem só uma palavra |
| **Gravar sua voz** | Microfone do navegador | Bom para treinar a própria pronúncia |
| **Enviar arquivo de áudio** | Qualquer MP3 ou OGG, por exemplo do [Forvo](https://forvo.com), do [Tatoeba](https://tatoeba.org) ou de uma TTS como o [ttsmaker.com](https://ttsmaker.com) | Para quando você quer uma voz específica |

Tradução: [MyMemory](https://mymemory.translated.net), grátis até cerca de 5.000 caracteres por dia, sem cadastro.

## Publicar no GitHub Pages (grátis)
1. Crie uma conta em https://github.com.
2. Clique em **New repository**, dê o nome `anki`, deixe como **Public** e crie.
3. Na página do repositório, clique em **uploading an existing file** e arraste `index.html`, `style.css`, `app.js`, `sync.js`, `supabase-config.js` e `whisper-worker.js`. Depois clique em **Commit changes**.
4. Abra **Settings → Pages**. Em *Source*, escolha **Deploy from a branch**, depois a branch **main**, a pasta **/ (root)**, e clique em **Save**.
5. Em 1 ou 2 minutos o site fica em `https://SEU-USUARIO.github.io/anki/`.

## Contas de usuário e banco de dados (Supabase, grátis)
Sem isso o app funciona normalmente, mas as cartas ficam só no navegador. Com isso, cada pessoa cria uma conta com e-mail e senha, e as cartas, o progresso e os áudios ficam salvos na nuvem e sincronizados entre PC e celular.

1. **Crie a conta e o projeto**: entre em https://supabase.com, clique em *Start your project*, faça login (dá para usar o GitHub) e clique em **New project**. Escolha um nome, crie uma senha do banco (guarde, mas o app não usa) e a região **South America (São Paulo)**. Espere uns 2 minutos.
2. **Crie as tabelas**: no menu da esquerda, abra **SQL Editor → New query**, cole todo o conteúdo de [`supabase-setup.sql`](supabase-setup.sql) e clique em **Run**. Deve aparecer "Success".
3. **Libere o endereço do site**: em **Authentication → URL Configuration**:
   - *Site URL*: `https://SEU-USUARIO.github.io/anki/`
   - *Redirect URLs*: adicione `https://SEU-USUARIO.github.io/anki/` e `http://localhost:8765/`
   Isso faz os links de confirmação de e-mail e de "esqueci a senha" voltarem para o app.
4. **Copie as chaves**: em **Project Settings → API** (ou *Data API / API Keys*), copie a **Project URL** e a chave **anon public** e cole em [`supabase-config.js`](supabase-config.js):
   ```js
   window.SUPABASE_URL = "https://xxxxxxxx.supabase.co";
   window.SUPABASE_ANON_KEY = "eyJhbGciOi...";
   ```
   A *anon key* pode ficar pública porque as regras do SQL garantem que cada usuário só acessa os próprios dados. **Nunca** use a `service_role` key no app.
5. Envie o `supabase-config.js` atualizado para o GitHub.

**Bom saber**
- **Confirmação de e-mail**: por padrão o Supabase exige que o usuário clique num link enviado por e-mail. O servidor de e-mail gratuito só manda **poucos e-mails por hora**. Se for só para você ou poucos amigos, dá para desligar em **Authentication → Sign In / Providers → Email → Confirm email**.
- **Pausa por inatividade**: o plano grátis pausa o projeto após 7 dias sem uso. Para reativar, abra o painel do Supabase e clique em *Restore*.
- **Limites grátis**: 500 MB de banco, que dá para centenas de milhares de cartas, e 1 GB de áudios, que dá para uns 30 mil recortes curtos.
- Na primeira vez que você entra, as cartas que já estavam no navegador são enviadas para a sua conta.
- Ao **sair**, as cartas são apagadas do navegador, mas continuam na conta. Isso é útil em computador compartilhado.
- O app funciona **offline** e sincroniza sozinho quando a internet volta. O status aparece no topo: ☁️ sincronizado, ⏳ pendente, 📴 offline.
