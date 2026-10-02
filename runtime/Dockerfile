FROM codercom/code-server:latest

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates git maven gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && npm install -g --no-audit --no-fund @angular/cli@20 \
 && ARCH="$(dpkg --print-architecture | sed 's/amd64/x64/;s/arm64/aarch64/')" \
 && mkdir -p /opt/jdk \
 && curl -fsSL "https://api.adoptium.net/v3/binary/latest/21/ga/linux/${ARCH}/jdk/hotspot/normal/eclipse" \
    | tar -xz -C /opt/jdk --strip-components=1 \
 && ln -s /opt/jdk/bin/java /usr/local/bin/java \
 && ln -s /opt/jdk/bin/javac /usr/local/bin/javac \
 && rm -rf /var/lib/apt/lists/*
ENV JAVA_HOME=/opt/jdk
ENV NG_CLI_ANALYTICS=false

USER coder
RUN code-server --install-extension vscjava.vscode-java-pack \
 && code-server --install-extension Continue.continue \
 && code-server --install-extension humao.rest-client

USER root
# El alumno (coder) no debe poder escalar a root: sin sudo, y el gate corre con otro usuario.
RUN rm -f /etc/sudoers.d/nopasswd \
 && useradd --system --no-create-home --shell /usr/sbin/nologin gate
COPY bootstrap.sh /usr/local/bin/bootstrap.sh
COPY session.sh /usr/local/bin/session.sh
COPY submit.sh /usr/local/bin/submit
COPY bash-hook.sh /etc/bash-hook.sh
COPY telemetry /opt/telemetry
COPY gate /opt/gate
COPY continue-config.yaml /opt/continue-config.yaml
RUN chmod +x /usr/local/bin/bootstrap.sh /usr/local/bin/session.sh /usr/local/bin/submit \
 && mkdir -p /workspace && chown coder:coder /workspace \
 && echo '. /etc/bash-hook.sh' >> /etc/bash.bashrc \
 && cd /opt/telemetry && npm install --omit=dev --no-audit --no-fund \
 && cd /opt/gate && npm install --omit=dev --no-audit --no-fund

# El entrypoint corre como root y baja privilegios (gate / coder).
USER root
WORKDIR /workspace
EXPOSE 7000 9081
ENTRYPOINT ["/usr/local/bin/bootstrap.sh"]
