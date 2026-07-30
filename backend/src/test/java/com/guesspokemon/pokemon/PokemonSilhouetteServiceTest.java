package com.guesspokemon.pokemon;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;

class PokemonSilhouetteServiceTest {

    @Test
    void should_preserveAlphaAndRemoveColor_when_artworkIsConverted() throws Exception {
        BufferedImage source =
                new BufferedImage(
                        2,
                        1,
                        BufferedImage.TYPE_INT_ARGB);
        source.setRGB(0, 0, new Color(255, 80, 20, 255).getRGB());
        source.setRGB(1, 0, new Color(20, 180, 255, 64).getRGB());
        ByteArrayOutputStream sourceBytes =
                new ByteArrayOutputStream();
        ImageIO.write(source, "png", sourceBytes);

        BufferedImage silhouette =
                ImageIO.read(
                        new ByteArrayInputStream(
                                PokemonSilhouetteService.createSilhouette(
                                        sourceBytes.toByteArray())));

        assertEquals(0xFF000000, silhouette.getRGB(0, 0));
        assertEquals(0x40000000, silhouette.getRGB(1, 0));
    }
}
