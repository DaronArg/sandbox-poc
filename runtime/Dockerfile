FROM codercom/code-server:latest

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates git maven gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && ARCH="$(dpkg --print-architecture | sed 's/amd64/x64/;s/arm64/aarch64/')" \
 && mkdir -p /opt/jdk \
 && curl -fsSL "https://api.adoptium.net/v3/binary/latest/21/ga/linux/${ARCH}/jdk/hotspot/normal/eclipse" \
    | tar -xz -C /opt/jdk --strip-components=1 \
 && ln -s /opt/jdk/bin/java /usr/local/bin/java \
 && ln -s /opt/jdk/bin/javac /usr/local/bin/javac \
 && rm -rf /var/lib/apt/lists/*
ENV JAVA_HOME=/opt/jdk

USER coder
RUN code-server --install-extension vscjava.vscode-java-pack \
 && code-server --install-extension Continue.continue

USER root
COPY bootstrap.sh /usr/local/bin/bootstrap.sh
COPY bash-hook.sh /etc/bash-hook.sh
COPY telemetry /opt/telemetry
RUN chmod +x /usr/local/bin/bootstrap.sh && mkdir -p /workspace && chown coder:coder /workspace  && echo '. /etc/bash-hook.sh' >> /etc/bash.bashrc  && cd /opt/telemetry && npm install --omit=dev --no-audit --no-fund

USER coder
WORKDIR /workspace
EXPOSE 8080 8081 4200
ENTRYPOINT ["/usr/local/bin/bootstrap.sh"]
