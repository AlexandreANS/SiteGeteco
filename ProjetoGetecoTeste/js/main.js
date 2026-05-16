// Conteúdo de: ProjetoGetecoTeste/js/main.js

document.addEventListener("DOMContentLoaded", () => {

    /**
     * Função para carregar o rodapé a partir de um arquivo externo
     */
    const loadFooter = async () => {
        // Pega o elemento <footer> da página
        const footerContainer = document.querySelector('footer');

        if (footerContainer) {
            try {
                // Busca o conteúdo do arquivo footer.html
                const response = await fetch('/footer.html');

                if (!response.ok) {
                    throw new Error(`Erro ao buscar o rodapé: ${response.statusText}`);
                }

                const footerHTML = await response.text();
                // Insere o HTML do arquivo dentro do elemento <footer>
                footerContainer.innerHTML = footerHTML;

            } catch (error) {
                console.error("Não foi possível carregar o rodapé:", error);
                // Fallback em caso de erro
                footerContainer.innerHTML = "<p>Não foi possível carregar o rodapé.</p>";
            }
        }
    };

    /**
     * Função para adicionar o efeito de "glass" e "scrolled" ao cabeçalho
     */
    const handleHeaderEffects = () => {
        const header = document.querySelector('header');
        if (header) {
            header.classList.add('glass');
            window.addEventListener('scroll', () => {
                if (window.scrollY > 50) {
                    header.classList.add('scrolled');
                } else {
                    header.classList.remove('scrolled');
                }
            });
        }
    };
 
    /**
     * Função para o carrossel de imagens com animação ruim
     */
    const handleCarousel = () => {
        const carousel = document.querySelector('.hero .carousel');
        if (carousel) {
            const images = carousel.querySelectorAll('img');
            let currentIndex = 0;

            setInterval(() => {
                images[currentIndex].classList.remove('active');
                currentIndex = (currentIndex + 1) % images.length;
                images[currentIndex].classList.add('active');
            }, 800); // Muda a imagem a cada 0.8 segundos para um efeito caótico
        }
    };

    // Função para criar toggles (botões de abrir/fechar) para introduções
    const handleIntroToggles = () => {
        const toggles = document.querySelectorAll('.intro-toggle');
        toggles.forEach(toggle => {
            const targetId = toggle.getAttribute('aria-controls');
            const target = targetId ? document.getElementById(targetId) : null;

            // Se o botão não tiver type, forçosamente define type button (evita submit acidental)
            if (!toggle.getAttribute('type')) toggle.setAttribute('type', 'button');

            // inicializa estado baseado no atributo hidden
            if (target) {
                const expanded = !target.hasAttribute('hidden');
                toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                if (!expanded) target.setAttribute('hidden', '');
            }

            toggle.addEventListener('click', (e) => {
                if (!target) return;
                const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
                if (isExpanded) {
                    toggle.setAttribute('aria-expanded', 'false');
                    target.setAttribute('hidden', '');
                } else {
                    toggle.setAttribute('aria-expanded', 'true');
                    target.removeAttribute('hidden');
                }
            });

            // Permite alternar também com Enter/Space (acessibilidade)
            toggle.addEventListener('keydown', (e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    toggle.click();
                }
            });
        });
    };

    // Executa as duas funções quando a página carregar
    loadFooter();
    handleHeaderEffects();
    handleCarousel();
    handleIntroToggles();
});