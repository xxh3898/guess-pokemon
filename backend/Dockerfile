FROM gradle:9.5.1-jdk21-alpine AS dependencies

WORKDIR /workspace

COPY --chown=gradle:gradle backend/gradle ./gradle
COPY --chown=gradle:gradle backend/gradlew backend/build.gradle backend/settings.gradle ./
RUN ./gradlew dependencies --configuration runtimeClasspath --no-daemon

FROM dependencies AS development

COPY --chown=gradle:gradle backend/src ./src

EXPOSE 8080

CMD ["./gradlew", "bootRun", "--no-daemon"]

FROM development AS build

RUN ./gradlew bootJar --no-daemon \
    && cp "$(find build/libs -maxdepth 1 -type f -name '*.jar' ! -name '*-plain.jar' -print -quit)" /workspace/application.jar

FROM eclipse-temurin:21.0.11_10-jre-alpine-3.23 AS runtime

RUN addgroup -S guesspokemon \
    && adduser -S -G guesspokemon guesspokemon

WORKDIR /app

COPY --from=build --chown=guesspokemon:guesspokemon /workspace/application.jar ./application.jar

USER guesspokemon

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/application.jar"]
