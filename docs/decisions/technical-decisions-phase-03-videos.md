# Decisões técnicas — Fase 03: Upload e processamento de vídeos

## Escopo e limites

Esta fase entrega somente o pipeline de upload e processamento no backend/worker/infra. Publicação, visibilidade, comentários, likes, inscrições e frontend ficam para fases posteriores. O limite de entrada é **10 GiB (10 \* 1024³ bytes)**. Multipart usa partes de **64 MiB**, com expiração de presigned URLs em 15 minutos; drafts incompletos expiram em 24 horas.

## TD-03.1 — Fila

**Decisão:** BullMQ sobre Redis, com `jobId=video:<uuid>`, três tentativas, backoff exponencial de 5 segundos e worker separado.

**Alternativas:** RabbitMQ exigiria outra semântica de job e mais infraestrutura; uma tabela de jobs não oferece o retry/claim operacional necessário. A documentação do BullMQ confirma integração NestJS e jobs idempotentes via job IDs.

## TD-03.2 — Upload e storage

**Decisão:** MinIO local via API S3 usando `@aws-sdk/client-s3`, `@aws-sdk/lib-storage` apenas no cliente futuro, e presigned multipart URLs geradas pela API. Os bytes não passam pelo NestJS; o servidor somente cria multipart, assina partes, conclui e consulta metadados.

**Alternativas:** `multer`/proxy multipart no NestJS consumiria memória/banda da API e não atende 10 GiB com retomada. MinIO é compatível com o contrato S3 e mantém o ambiente local reproduzível.

## TD-03.3 — Processamento

**Decisão:** worker Node separado executa `ffprobe -of json` para metadados e `ffmpeg -ss 00:00:01 -frames:v 1` para thumbnail. O worker baixa o objeto para arquivo temporário, nunca para um Buffer de 10 GiB, e atualiza o estado somente após artefatos persistirem.

**Alternativas:** processar dentro do API bloqueia recursos; uma função serverless não é parte do ambiente Docker local.

## TD-03.4 — Modelo de estados

`DRAFT -> PROCESSING -> READY | ERROR`. Conclusão idempotente não reenfileira um vídeo em `PROCESSING`/`READY`; falha do worker grava `ERROR` após a última tentativa. Não há transição de publicação nesta fase.

## TD-03.5 — URL e streaming

O ID interno UUID não é exposto como URL pública. Cada vídeo possui `public_key` aleatório de 22 caracteres URL-safe com índice único. Playback e download são endpoints públicos que obtêm `Content-Length`/`Content-Type` e fazem `GetObject` com `Range`; o NestJS encaminha o stream de resposta e nunca carrega o arquivo inteiro.

## TD-03.6 — Autorização e erros

Criação, assinatura e conclusão exigem JWT e pertencimento ao canal do usuário. Playback/download são públicos somente para `READY`. O filtro de domínio existente continua sendo a forma única de serializar `error`, `message` e `statusCode`.

## Referências verificadas

- BullMQ NestJS guide: https://docs.bullmq.io/guide/nestjs/
- AWS SDK for JavaScript v3 S3 examples: https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html
- `ffprobe` manual: https://ffmpeg.org/ffprobe.html
- `ffmpeg` manual: https://ffmpeg.org/ffmpeg.html
- TypeORM 0.3 migrations/repositories: APIs already used by this repository and locked in `nestjs-project/package.json`.
